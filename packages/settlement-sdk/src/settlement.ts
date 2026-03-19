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

  // ── Protocol-generic types ──────────────────────────────

  /** Aave protocol descriptor */
  export interface AaveProtocol {
    protocol: 'aave'
    pool: AavePool
    /** Lender ID (default: 0 = Aave V3) */
    lender?: number
    /** Interest rate mode (default: 2 = variable) */
    mode?: number
  }

  /** Morpho Blue protocol descriptor */
  export interface MorphoProtocol {
    protocol: 'morpho'
    market: MorphoMarketParams
    /** Morpho Blue contract address */
    morpho: Address
    /** Lender ID (default: 4000 = Morpho) */
    lender?: number
  }

  /** Discriminated union — any supported lending protocol */
  export type ProtocolSide = AaveProtocol | MorphoProtocol

  // ── Protocol action helpers ─────────────────────────────

  /** Build repay + withdraw data for a protocol side (used as source) */
  function buildSourceActions(
    side: ProtocolSide,
  ): { repayData: Hex; withdrawData: Hex; lender: number } {
    if (side.protocol === 'aave') {
      const mode = side.mode ?? 2
      const lender = side.lender ?? 0
      return {
        repayData: AaveData.repay(side.pool.debtToken, side.pool.pool, mode),
        withdrawData: AaveData.withdraw(side.pool.aToken, side.pool.pool),
        lender,
      }
    }
    const lender = side.lender ?? 4000
    return {
      repayData: MorphoData.depositOrRepay(side.market, side.morpho),
      withdrawData: MorphoData.borrowOrWithdraw(side.market, side.morpho),
      lender,
    }
  }

  /** Build deposit + borrow data for a protocol side (used as destination) */
  function buildDestActions(
    side: ProtocolSide,
  ): { depositData: Hex; borrowData: Hex; lender: number } {
    if (side.protocol === 'aave') {
      const mode = side.mode ?? 2
      const lender = side.lender ?? 0
      return {
        depositData: AaveData.deposit(side.pool.pool),
        borrowData: AaveData.borrow(side.pool.pool, mode),
        lender,
      }
    }
    const lender = side.lender ?? 4000
    return {
      depositData: MorphoData.depositOrRepay(side.market, side.morpho),
      borrowData: MorphoData.borrowOrWithdraw(side.market, side.morpho),
      lender,
    }
  }

  // ── 1. Position Migration (same-asset, pool-to-pool) ────

  export interface MigrationParams {
    /** Collateral token (e.g. WETH) */
    collateralAsset: Address
    /** Debt token (e.g. USDC) */
    debtAsset: Address
    /** Source protocol */
    source: ProtocolSide
    /** Destination protocol */
    dest: ProtocolSide
    /** User address (receiver for deposit/borrow) */
    user: Address
    /** Settlement contract address (receiver for withdraw) */
    settlement: Address
    /** Borrow amount on destination (slightly > debt to cover rounding + fee) */
    borrowAmount: bigint
    /** Fee recipient address */
    feeRecipient?: Address
    /** Post-settlement health factor conditions */
    conditions?: Condition[]
  }

  /**
   * Build calldata for a same-asset position migration between protocols.
   *
   * Flow: flash loan → repay source → withdraw source → deposit dest → borrow dest
   */
  export function buildMigration(params: MigrationParams): Result {
    const src = buildSourceActions(params.source)
    const dst = buildDestActions(params.dest)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender: src.lender, data: src.repayData },
      { op: LenderOps.WITHDRAW, lender: src.lender, data: src.withdrawData },
      { op: LenderOps.DEPOSIT, lender: dst.lender, data: dst.depositData },
      { op: LenderOps.BORROW, lender: dst.lender, data: dst.borrowData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtAsset,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender: src.lender,
        data: src.repayData,
        proof: proofs[0],
      },
      {
        asset: params.collateralAsset,
        amount: AmountSentinel.MAX,
        receiver: params.settlement,
        op: LenderOps.WITHDRAW,
        lender: src.lender,
        data: src.withdrawData,
        proof: proofs[1],
      },
    ]

    const postActions: ActionCalldata[] = [
      {
        asset: params.collateralAsset,
        amount: AmountSentinel.BALANCE,
        receiver: params.user,
        op: LenderOps.DEPOSIT,
        lender: dst.lender,
        data: dst.depositData,
        proof: proofs[2],
      },
      {
        asset: params.debtAsset,
        amount: params.borrowAmount,
        receiver: params.settlement,
        op: LenderOps.BORROW,
        lender: dst.lender,
        data: dst.borrowData,
        proof: proofs[3],
      },
    ]

    const settlementData = encodeSettlementData([], params.conditions)
    const orderData = encodeOrderData(root, settlementData.length > 4 ? settlementData : undefined)
    const executionData = encodeExecutionData(preActions, postActions, params.feeRecipient)

    return { orderData, executionData, fillerCalldata: '0x', merkleRoot: root, settlementData }
  }

  // ── 1b. Simple Migration (Aave-to-Aave with APR check) ──

  export interface SimpleMigrationParams {
    collateralAsset: Address
    debtAsset: Address
    /** Source Aave pool */
    source: AaveProtocol
    /** Destination Aave pool */
    dest: AaveProtocol
    user: Address
    settlement: Address
    borrowAmount: bigint
    feeRecipient?: Address
    conditions?: Condition[]
  }

  /**
   * Build calldata for an Aave-to-Aave migration using MigrationSettlement (APR-validated).
   * Requires both sides to be Aave so the contract can compare borrow rates.
   */
  export function buildSimpleMigration(params: SimpleMigrationParams): Result {
    const result = buildMigration(params)

    const settlementData = encodeMigrationSettlementData(
      params.source.pool.pool,
      params.dest.pool.pool,
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
    /** Protocol where the position lives */
    protocol: ProtocolSide
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
  }

  /**
   * Build calldata for a collateral swap.
   *
   * Flow: flash loan debt → repay debt → withdraw old collateral → swap → deposit new collateral → re-borrow
   */
  export function buildCollateralSwap(params: CollateralSwapParams): Result {
    const src = buildSourceActions(params.protocol)
    const dst = buildDestActions(params.protocol)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender: src.lender, data: src.repayData },
      { op: LenderOps.WITHDRAW, lender: src.lender, data: src.withdrawData },
      { op: LenderOps.DEPOSIT, lender: dst.lender, data: dst.depositData },
      { op: LenderOps.BORROW, lender: dst.lender, data: dst.borrowData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtAsset,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender: src.lender,
        data: src.repayData,
        proof: proofs[0],
      },
      {
        asset: params.collateralIn,
        amount: AmountSentinel.MAX,
        receiver: params.settlement,
        op: LenderOps.WITHDRAW,
        lender: src.lender,
        data: src.withdrawData,
        proof: proofs[1],
      },
    ]

    const postActions: ActionCalldata[] = [
      {
        asset: params.collateralOut,
        amount: AmountSentinel.BALANCE,
        receiver: params.user,
        op: LenderOps.DEPOSIT,
        lender: dst.lender,
        data: dst.depositData,
        proof: proofs[2],
      },
      {
        asset: params.debtAsset,
        amount: params.borrowAmount,
        receiver: params.settlement,
        op: LenderOps.BORROW,
        lender: dst.lender,
        data: dst.borrowData,
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
    /** Source protocol (where old debt lives) */
    source: ProtocolSide
    /** Destination protocol (where new debt goes — can be same) */
    dest: ProtocolSide
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
  }

  /**
   * Build calldata for a debt swap.
   *
   * Flow: flash loan old debt → repay old debt → borrow new debt → swap new→old → repay flash loan
   */
  export function buildDebtSwap(params: DebtSwapParams): Result {
    const src = buildSourceActions(params.source)
    const dst = buildDestActions(params.dest)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender: src.lender, data: src.repayData },
      { op: LenderOps.BORROW, lender: dst.lender, data: dst.borrowData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtIn,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender: src.lender,
        data: src.repayData,
        proof: proofs[0],
      },
    ]

    const postActions: ActionCalldata[] = [
      {
        asset: params.debtOut,
        amount: params.borrowAmount,
        receiver: params.settlement,
        op: LenderOps.BORROW,
        lender: dst.lender,
        data: dst.borrowData,
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
    /** Protocol where the position lives */
    protocol: ProtocolSide
    /** Oracle for swap verification */
    oracle: Address
    swapTolerance: bigint
    user: Address
    settlement: Address
    swap: Omit<SwapParams, 'assetIn' | 'assetOut'>
    conditions?: Condition[]
  }

  /**
   * Build calldata for closing a position (repay debt + withdraw all collateral).
   *
   * Flow: flash loan debt → repay debt → withdraw collateral → swap collateral→debt → repay flash loan
   * Excess stays in contract (non-borrow surplus, no sweep).
   */
  export function buildClosePosition(params: ClosePositionParams): Result {
    const src = buildSourceActions(params.protocol)

    const { root, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender: src.lender, data: src.repayData },
      { op: LenderOps.WITHDRAW, lender: src.lender, data: src.withdrawData },
    ])

    const preActions: ActionCalldata[] = [
      {
        asset: params.debtAsset,
        amount: AmountSentinel.MAX,
        receiver: params.user,
        op: LenderOps.REPAY,
        lender: src.lender,
        data: src.repayData,
        proof: proofs[0],
      },
      {
        asset: params.collateralAsset,
        amount: AmountSentinel.MAX,
        receiver: params.settlement,
        op: LenderOps.WITHDRAW,
        lender: src.lender,
        data: src.withdrawData,
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

  // ── 5. Cross-Protocol Migration ──────────────────────────

  export interface CrossProtocolMigrationParams {
    /** Collateral asset (e.g. wstETH) */
    collateralAsset: Address
    /** Debt asset (e.g. WETH) */
    debtAsset: Address
    /** Source protocol (where the position currently lives) */
    source: ProtocolSide
    /** Destination protocol (where the position is moving to) */
    dest: ProtocolSide
    /** User address */
    user: Address
    /** Settlement contract */
    settlement: Address
    /** Amount to borrow on destination (to repay flash loan) */
    borrowAmount: bigint
    /** Fee recipient */
    feeRecipient?: Address
    /** Post-settlement health factor conditions */
    conditions?: Condition[]
  }

  /**
   * Build calldata for migrating a leveraged position between protocols.
   *
   * Supports any combination: Aave→Morpho, Morpho→Aave, Aave→Aave (different lender IDs),
   * or Morpho→Morpho (different markets).
   *
   * Flow:
   *   flash loan debt → repay source → withdraw source collateral
   *   → deposit dest collateral → borrow dest → repay flash loan
   */
  export function buildCrossProtocolMigration(params: CrossProtocolMigrationParams): Result {
    return buildMigration(params)
  }
}
