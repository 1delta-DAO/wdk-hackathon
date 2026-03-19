import type { Hex } from 'viem'
import type { Address } from './constants.js'
import { LenderOps, AmountSentinel, SwapAmountSentinel } from './constants.js'
import { AaveData, MorphoData, defineOrder, type MorphoMarketParams } from './merkle.js'
import {
  encodeSettlementData,
  encodeMigrationSettlementData,
  encodeOrderData,
  encodeExecutionData,
  encodeFillerCalldata,
  type ActionCalldata,
  type SwapParams,
  type Conversion,
  type Condition,
} from './calldata.js'

// ═══════════════════════════════════════════════════════════
//  Settlement namespace — all high-level flow builders
// ═══════════════════════════════════════════════════════════

export namespace Settlement {

  // ── Common types ─────────────────────────────────────────

  export interface AavePool {
    pool: Address
    aToken: Address
    debtToken: Address
  }

  export interface Result {
    orderData: Hex
    executionData: Hex
    fillerCalldata: Hex
    merkleRoot: Hex
    /** Raw settlement data — pass to buildSettlementOrderMessage for signing */
    settlementData: Hex
  }

  // ── 1. Position Migration (same-asset, pool-to-pool) ────

  export interface MigrationParams {
    /** Collateral token (e.g. WETH) */
    collateralAsset: Address
    /** Debt token (e.g. USDC) */
    debtAsset: Address
    /** Source pool */
    source: AavePool
    /** Destination pool */
    dest: AavePool
    /** User address (receiver for deposit/borrow) */
    user: Address
    /** Settlement contract address (receiver for withdraw) */
    settlement: Address
    /** Borrow amount on destination (slightly > debt to cover rounding + fee) */
    borrowAmount: bigint
    /** Fee recipient address */
    feeRecipient?: Address
    /** Aave interest rate mode (default: 2 = variable) */
    mode?: number
    /** Lender ID for source/dest (default: 0 = Aave V3) */
    lender?: number
  }

  /**
   * Build calldata for a same-asset position migration between Aave pools.
   *
   * Flow: flash loan → repay source → withdraw source → deposit dest → borrow dest
   */
  export function buildMigration(params: MigrationParams): Result {
    const mode = params.mode ?? 2
    const lender = params.lender ?? 0

    const repayData = AaveData.repay(params.source.debtToken, params.source.pool, mode)
    const withdrawData = AaveData.withdraw(params.source.aToken, params.source.pool)
    const depositData = AaveData.deposit(params.dest.pool)
    const borrowData = AaveData.borrow(params.dest.pool, mode)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender, data: repayData },
      { op: LenderOps.WITHDRAW, lender, data: withdrawData },
      { op: LenderOps.DEPOSIT, lender, data: depositData },
      { op: LenderOps.BORROW, lender, data: borrowData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtAsset,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender,
        data: repayData,
        proof: proofs[0],
      },
      {
        asset: params.collateralAsset,
        amount: AmountSentinel.MAX,
        receiver: params.settlement,
        op: LenderOps.WITHDRAW,
        lender,
        data: withdrawData,
        proof: proofs[1],
      },
    ]

    const postActions: ActionCalldata[] = [
      {
        asset: params.collateralAsset,
        amount: AmountSentinel.BALANCE,
        receiver: params.user,
        op: LenderOps.DEPOSIT,
        lender,
        data: depositData,
        proof: proofs[2],
      },
      {
        asset: params.debtAsset,
        amount: params.borrowAmount,
        receiver: params.settlement,
        op: LenderOps.BORROW,
        lender,
        data: borrowData,
        proof: proofs[3],
      },
    ]

    const orderData = encodeOrderData(root)
    const executionData = encodeExecutionData(preActions, postActions, params.feeRecipient)

    return { orderData, executionData, fillerCalldata: '0x', merkleRoot: root, settlementData: '0x' }
  }

  // ── 1b. Simple Migration (with APR check) ────────────────

  export interface SimpleMigrationParams extends MigrationParams {
    /** Settlement checks dest rate < source rate */
  }

  /**
   * Build calldata for a simple migration using MigrationSettlement (APR-validated).
   */
  export function buildSimpleMigration(params: SimpleMigrationParams): Result {
    const result = buildMigration(params)

    const settlementData = encodeMigrationSettlementData(
      params.source.pool,
      params.dest.pool,
      params.debtAsset,
    )
    const orderData = encodeOrderData(result.merkleRoot, settlementData)

    return { ...result, orderData, settlementData }
  }

  // ── 2. Collateral Swap ────────────────────────────────────

  export interface CollateralSwapParams {
    /** Current collateral (will be withdrawn and swapped) */
    collateralIn: Address
    /** New collateral (swap output, will be deposited) */
    collateralOut: Address
    /** Debt asset (repaid then re-borrowed to cover flash loan) */
    debtAsset: Address
    /** Pool info */
    pool: AavePool & { aTokenOut: Address }
    /** Oracle address for swap verification */
    oracle: Address
    /** Swap tolerance (e.g. 50_000n = 0.5%) */
    swapTolerance: bigint
    /** User address */
    user: Address
    /** Settlement contract */
    settlement: Address
    /** Borrow amount (to repay flash loan) */
    borrowAmount: bigint
    /** DEX swap params */
    swap: Omit<SwapParams, 'assetIn' | 'assetOut'>
    /** Fee recipient */
    feeRecipient?: Address
    /** Health factor conditions */
    conditions?: Condition[]
    mode?: number
    lender?: number
  }

  /**
   * Build calldata for a collateral swap.
   *
   * Flow: flash loan debt → repay debt → withdraw old collateral → swap → deposit new collateral → re-borrow
   */
  export function buildCollateralSwap(params: CollateralSwapParams): Result {
    const mode = params.mode ?? 2
    const lender = params.lender ?? 0

    const repayData = AaveData.repay(params.pool.debtToken, params.pool.pool, mode)
    const withdrawData = AaveData.withdraw(params.pool.aToken, params.pool.pool)
    const depositData = AaveData.deposit(params.pool.pool)
    const borrowData = AaveData.borrow(params.pool.pool, mode)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender, data: repayData },
      { op: LenderOps.WITHDRAW, lender, data: withdrawData },
      { op: LenderOps.DEPOSIT, lender, data: depositData },
      { op: LenderOps.BORROW, lender, data: borrowData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtAsset,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender,
        data: repayData,
        proof: proofs[0],
      },
      {
        asset: params.collateralIn,
        amount: AmountSentinel.MAX,
        receiver: params.settlement,
        op: LenderOps.WITHDRAW,
        lender,
        data: withdrawData,
        proof: proofs[1],
      },
    ]

    const postActions: ActionCalldata[] = [
      {
        asset: params.collateralOut,
        amount: AmountSentinel.BALANCE,
        receiver: params.user,
        op: LenderOps.DEPOSIT,
        lender,
        data: depositData,
        proof: proofs[2],
      },
      {
        asset: params.debtAsset,
        amount: params.borrowAmount,
        receiver: params.settlement,
        op: LenderOps.BORROW,
        lender,
        data: borrowData,
        proof: proofs[3],
      },
    ]

    const conversions: Conversion[] = [{
      assetIn: params.collateralIn,
      assetOut: params.collateralOut,
      oracle: params.oracle,
      swapTolerance: params.swapTolerance,
    }]

    const settlementData = encodeSettlementData(conversions, params.conditions)
    const orderData = encodeOrderData(root, settlementData)
    const executionData = encodeExecutionData(preActions, postActions, params.feeRecipient)
    const fillerCalldata = encodeFillerCalldata([{
      assetIn: params.collateralIn,
      assetOut: params.collateralOut,
      ...params.swap,
    }])

    return { orderData, executionData, fillerCalldata, merkleRoot: root, settlementData }
  }

  // ── 3. Debt Swap ──────────────────────────────────────────

  export interface DebtSwapParams {
    /** Current debt asset (will be repaid) */
    debtIn: Address
    /** New debt asset (will be borrowed) */
    debtOut: Address
    /** Collateral asset (untouched) */
    collateralAsset: Address
    /** Source pool (where old debt lives) */
    sourcePool: AavePool
    /** Dest pool (where new debt goes — can be same pool) */
    destPool: AavePool
    /** Oracle for swap verification */
    oracle: Address
    swapTolerance: bigint
    user: Address
    settlement: Address
    /** Amount to borrow of new debt asset */
    borrowAmount: bigint
    swap: Omit<SwapParams, 'assetIn' | 'assetOut'>
    feeRecipient?: Address
    conditions?: Condition[]
    mode?: number
    lender?: number
  }

  /**
   * Build calldata for a debt swap.
   *
   * Flow: flash loan old debt → repay old debt → borrow new debt → swap new→old → repay flash loan
   */
  export function buildDebtSwap(params: DebtSwapParams): Result {
    const mode = params.mode ?? 2
    const lender = params.lender ?? 0

    const repayData = AaveData.repay(params.sourcePool.debtToken, params.sourcePool.pool, mode)
    const borrowData = AaveData.borrow(params.destPool.pool, mode)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender, data: repayData },
      { op: LenderOps.BORROW, lender, data: borrowData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtIn,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender,
        data: repayData,
        proof: proofs[0],
      },
    ]

    const postActions: ActionCalldata[] = [
      {
        asset: params.debtOut,
        amount: params.borrowAmount,
        receiver: params.settlement,
        op: LenderOps.BORROW,
        lender,
        data: borrowData,
        proof: proofs[1],
      },
    ]

    const conversions: Conversion[] = [{
      assetIn: params.debtOut,
      assetOut: params.debtIn,
      oracle: params.oracle,
      swapTolerance: params.swapTolerance,
    }]

    const settlementData = encodeSettlementData(conversions, params.conditions)
    const orderData = encodeOrderData(root, settlementData)
    const executionData = encodeExecutionData(preActions, postActions, params.feeRecipient)
    const fillerCalldata = encodeFillerCalldata([{
      assetIn: params.debtOut,
      assetOut: params.debtIn,
      ...params.swap,
    }])

    return { orderData, executionData, fillerCalldata, merkleRoot: root, settlementData }
  }

  // ── 4. Close Position ─────────────────────────────────────

  export interface ClosePositionParams {
    /** Collateral asset (withdrawn and swapped to cover debt) */
    collateralAsset: Address
    /** Debt asset */
    debtAsset: Address
    /** Pool info */
    pool: AavePool
    /** Oracle for swap verification */
    oracle: Address
    swapTolerance: bigint
    user: Address
    settlement: Address
    swap: Omit<SwapParams, 'assetIn' | 'assetOut'>
    conditions?: Condition[]
    mode?: number
    lender?: number
  }

  /**
   * Build calldata for closing a position (repay debt + withdraw all collateral).
   *
   * Flow: flash loan debt → repay debt → withdraw collateral → swap collateral→debt → repay flash loan
   * Excess stays in contract (non-borrow surplus, no sweep).
   */
  export function buildClosePosition(params: ClosePositionParams): Result {
    const mode = params.mode ?? 2
    const lender = params.lender ?? 0

    const repayData = AaveData.repay(params.pool.debtToken, params.pool.pool, mode)
    const withdrawData = AaveData.withdraw(params.pool.aToken, params.pool.pool)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender, data: repayData },
      { op: LenderOps.WITHDRAW, lender, data: withdrawData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtAsset,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender,
        data: repayData,
        proof: proofs[0],
      },
      {
        asset: params.collateralAsset,
        amount: AmountSentinel.MAX,
        receiver: params.settlement,
        op: LenderOps.WITHDRAW,
        lender,
        data: withdrawData,
        proof: proofs[1],
      },
    ]

    const conversions: Conversion[] = [{
      assetIn: params.collateralAsset,
      assetOut: params.debtAsset,
      oracle: params.oracle,
      swapTolerance: params.swapTolerance,
    }]

    const settlementData = encodeSettlementData(conversions, params.conditions)
    const orderData = encodeOrderData(root, settlementData)
    const executionData = encodeExecutionData(preActions, [])
    const fillerCalldata = encodeFillerCalldata([{
      assetIn: params.collateralAsset,
      assetOut: params.debtAsset,
      ...params.swap,
    }])

    return { orderData, executionData, fillerCalldata, merkleRoot: root, settlementData }
  }

  // ── 5. Cross-Protocol Migration (e.g. Aave → Morpho) ─────

  export interface CrossProtocolMigrationParams {
    /** Collateral asset (e.g. wstETH) */
    collateralAsset: Address
    /** Debt asset (e.g. WETH) */
    debtAsset: Address
    /** Source: Aave pool info */
    source: AavePool
    /** Source lender ID (default: 0 = Aave V3) */
    sourceLender?: number
    /** Destination: Morpho market params */
    destMarket: MorphoMarketParams
    /** Morpho Blue contract address */
    morpho: Address
    /** Destination lender ID (default: 4000 = Morpho) */
    destLender?: number
    /** User address */
    user: Address
    /** Settlement contract */
    settlement: Address
    /** Amount to borrow on Morpho (to repay flash loan) */
    borrowAmount: bigint
    /** Fee recipient */
    feeRecipient?: Address
    /** Aave interest rate mode (default: 2 = variable) */
    mode?: number
    /** Post-settlement health factor conditions */
    conditions?: Condition[]
  }

  /**
   * Build calldata for migrating a leveraged position from Aave to Morpho Blue.
   *
   * Flow:
   *   flash loan debt → repay Aave debt → withdraw Aave collateral
   *   → deposit Morpho collateral → borrow Morpho debt → repay flash loan
   */
  export function buildCrossProtocolMigration(params: CrossProtocolMigrationParams): Result {
    const mode = params.mode ?? 2
    const srcLender = params.sourceLender ?? 0
    const dstLender = params.destLender ?? 4000

    // Source (Aave) actions
    const repayData = AaveData.repay(params.source.debtToken, params.source.pool, mode)
    const withdrawData = AaveData.withdraw(params.source.aToken, params.source.pool)

    // Destination (Morpho) actions
    const morphoDepositData = MorphoData.depositOrRepay(params.destMarket, params.morpho)
    const morphoBorrowData = MorphoData.borrowOrWithdraw(params.destMarket, params.morpho)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender: srcLender, data: repayData },
      { op: LenderOps.WITHDRAW, lender: srcLender, data: withdrawData },
      { op: LenderOps.DEPOSIT, lender: dstLender, data: morphoDepositData },
      { op: LenderOps.BORROW, lender: dstLender, data: morphoBorrowData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtAsset,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender: srcLender,
        data: repayData,
        proof: proofs[0],
      },
      {
        asset: params.collateralAsset,
        amount: AmountSentinel.MAX,
        receiver: params.settlement,
        op: LenderOps.WITHDRAW,
        lender: srcLender,
        data: withdrawData,
        proof: proofs[1],
      },
    ]

    const postActions: ActionCalldata[] = [
      {
        asset: params.collateralAsset,
        amount: AmountSentinel.BALANCE,
        receiver: params.user,
        op: LenderOps.DEPOSIT,
        lender: dstLender,
        data: morphoDepositData,
        proof: proofs[2],
      },
      {
        asset: params.debtAsset,
        amount: params.borrowAmount,
        receiver: params.settlement,
        op: LenderOps.BORROW,
        lender: dstLender,
        data: morphoBorrowData,
        proof: proofs[3],
      },
    ]

    const settlementData = encodeSettlementData([], params.conditions)
    const orderData = encodeOrderData(root, settlementData.length > 4 ? settlementData : undefined)
    const executionData = encodeExecutionData(preActions, postActions, params.feeRecipient)

    return { orderData, executionData, fillerCalldata: '0x', merkleRoot: root, settlementData }
  }
}
