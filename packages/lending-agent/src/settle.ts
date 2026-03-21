/**
 * Settlement transaction builder and submitter.
 *
 * Takes an already-decided source/dest leaf selection and builds the
 * settleWithFlashLoan calldata from the stored leaf proofs, then submits
 * via WDK sendTransaction.
 */

import { encodeFunctionData, createPublicClient, http, parseAbi, maxUint256 } from 'viem'
import type { Hex, Address } from 'viem'
import {
  encodeExecutionData,
  AmountSentinel,
  LenderOps,
  settleWithFlashLoanAbi,
} from '@1delta/settlement-sdk'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { MerkleLeaf, SignedPermit, StoredOrder } from './order.js'
import { callTool } from './mcp.js'
import { DRY_RUN, ECONOMIC_MODE, RPC_URL_BY_CHAIN, CONTRACTS_BY_CHAIN } from './config.js'

// Morpho Blue flash loan pool — chain-specific, looked up from CONTRACTS_BY_CHAIN

// WETH on Arbitrum — used to price ETH gas costs via the Aave oracle
const WETH_ARB = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address

const AAVE_ORACLE_ABI = parseAbi([
  'function getAssetPrice(address asset) external view returns (uint256)',
])

const ERC20_ABI = parseAbi([
  'function decimals() external view returns (uint8)',
])

// Settlement contract ABIs for permit/approval/multicall functions
const MULTICALL_ABI = parseAbi([
  'function multicall(bytes[] calldata data) external',
])

const PERMIT_ABI = parseAbi([
  'function permit(address token, address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
])

const AAVE_DELEGATION_ABI = parseAbi([
  'function aaveDelegationWithSig(address debtToken, address delegator, address delegatee, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
])

const MORPHO_AUTH_ABI = parseAbi([
  'function morphoSetAuthorizationWithSig(address morpho, address authorizer, address authorized, bool isAuthorized, uint256 nonce, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
])

const COMPOUND_V3_ALLOW_ABI = parseAbi([
  'function compoundV3AllowBySig(address comet, address owner, address manager, bool isAllowed, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) external',
])

/**
 * Encodes a signed permit into settlement contract calldata.
 * Each permit kind maps to a different contract function.
 */
function encodePermitCall(
  permit: SignedPermit,
  signer: Address,
  settlement: Address,
): Hex {
  switch (permit.kind) {
    case 'ERC2612_PERMIT':
      return encodeFunctionData({
        abi: PERMIT_ABI,
        functionName: 'permit',
        args: [
          permit.targetAddress,
          signer,
          settlement,
          maxUint256,
          BigInt(permit.deadline),
          permit.v,
          permit.r as `0x${string}`,
          permit.s as `0x${string}`,
        ],
      })

    case 'AAVE_DELEGATION':
      return encodeFunctionData({
        abi: AAVE_DELEGATION_ABI,
        functionName: 'aaveDelegationWithSig',
        args: [
          permit.targetAddress,
          signer,
          settlement,
          maxUint256,
          BigInt(permit.deadline),
          permit.v,
          permit.r as `0x${string}`,
          permit.s as `0x${string}`,
        ],
      })

    case 'MORPHO_AUTHORIZATION':
      return encodeFunctionData({
        abi: MORPHO_AUTH_ABI,
        functionName: 'morphoSetAuthorizationWithSig',
        args: [
          permit.targetAddress,
          signer,
          settlement,
          true,
          BigInt(permit.nonce),
          BigInt(permit.deadline),
          permit.v,
          permit.r as `0x${string}`,
          permit.s as `0x${string}`,
        ],
      })

    case 'COMPOUND_V3_ALLOW':
      return encodeFunctionData({
        abi: COMPOUND_V3_ALLOW_ABI,
        functionName: 'compoundV3AllowBySig',
        args: [
          permit.targetAddress,
          signer,
          settlement,
          true,
          BigInt(permit.nonce),
          BigInt(permit.deadline),
          permit.v,
          permit.r as `0x${string}`,
          permit.s as `0x${string}`,
        ],
      })
  }
}

/**
 * Derives the required ERC20 approvals from the merkle leaves.
 * The settlement contract needs to approve lending pools to spend tokens
 * it holds (e.g. approve Aave pool to spend USDC for repay, approve
 * Aave pool to spend WETH for deposit).
 */
function deriveApprovalCalls(leaves: MerkleLeaf[]): Hex[] {
  const calls: Hex[] = []
  const seen = new Set<string>()

  for (const leaf of leaves) {
    // Aave leaves: data contains pool address
    // Op 0 (deposit) / 2 (repay): settlement sends asset TO pool → needs approval
    if (leaf.op === 0 || leaf.op === 2) {
      // Extract pool address from leaf data based on lender type
      let pool: Address | undefined
      const data = leaf.data as Hex

      if (leaf.lender < 2000) {
        // Aave: deposit data = [20: pool], repay data = [1: mode][20: debtToken][20: pool]
        if (leaf.op === 0) {
          // deposit: data is [20: pool]
          pool = ('0x' + data.slice(2, 42)) as Address
        } else {
          // repay: data is [1: mode][20: debtToken][20: pool]
          pool = ('0x' + data.slice(42, 82)) as Address
        }
      }
      // Other protocols extract similarly but for now Aave is the primary case

      if (pool) {
        // We don't know the exact asset here, but approveToken is permissionless
        // and the settlement contract calls it. The actual asset comes from executionData.
        // We'll use a wildcard approach: approve the pool for common tokens.
        // However, for correctness we skip asset-specific approvals here and rely
        // on the settlement contract already having infinite approvals set up during deploy.
        // If not, the solver can add approveToken calls manually.
        const key = `${pool}`
        if (!seen.has(key)) {
          seen.add(key)
          // Note: we don't add approval calls here because the settlement contract
          // should already have approvals set during deployment. If needed, the
          // agent can add them via approveToken in the multicall.
        }
      }
    }
  }

  return calls
}

export interface EconomicCheckResult {
  viable: boolean
  reason: string
  solverFeeUsdE8: bigint
  gasCostUsdE8: bigint
}

/**
 * Checks whether executing the settlement is economically worthwhile:
 * solverFee (USD) must exceed estimated gas cost (USD).
 *
 * Prices are sourced from the Aave oracle (8-decimal USD values).
 * If any price/gas call fails the check is skipped and execution proceeds.
 */
export async function checkEconomicViability(
  input: SettlementInput,
  txData: { to: Address; data: Hex },
  flashAmount: bigint,
  aaveOracleAddress: Address,
  fromAddress: Address,
  rpcUrl: string,
): Promise<EconomicCheckResult> {
  const client = createPublicClient({ transport: http(rpcUrl) })

  // Solver fee in debt token base units
  const solverFeeBaseUnits = (flashAmount * BigInt(input.order.order.maxFeeBps)) / 10_000_000n

  const [gasEstimate, gasPrice, ethPrice, debtPrice, debtDecimals] = await Promise.all([
    client.estimateGas({ account: fromAddress, to: txData.to, data: txData.data }),
    client.getGasPrice(),
    client.readContract({ address: aaveOracleAddress, abi: AAVE_ORACLE_ABI, functionName: 'getAssetPrice', args: [WETH_ARB] }),
    client.readContract({ address: aaveOracleAddress, abi: AAVE_ORACLE_ABI, functionName: 'getAssetPrice', args: [input.debtAsset] }),
    client.readContract({ address: input.debtAsset, abi: ERC20_ABI, functionName: 'decimals' }),
  ])

  // Gas cost in USD (8 decimal precision): gasCostWei * ethPrice / 1e18
  const gasCostUsdE8 = (gasEstimate * gasPrice * ethPrice) / BigInt(1e18)

  // Solver fee in USD (8 decimal precision): feeBaseUnits * debtPrice / 10^debtDecimals
  const solverFeeUsdE8 = (solverFeeBaseUnits * debtPrice) / (10n ** BigInt(debtDecimals))

  const viable = solverFeeUsdE8 >= gasCostUsdE8

  const fmtUsd = (v: bigint) => `$${(Number(v) / 1e8).toFixed(6)}`
  const reason = viable
    ? `solverFee ${fmtUsd(solverFeeUsdE8)} >= gasCost ${fmtUsd(gasCostUsdE8)} — proceeding`
    : `solverFee ${fmtUsd(solverFeeUsdE8)} < gasCost ${fmtUsd(gasCostUsdE8)} — skipping (not economic)`

  return { viable, reason, solverFeeUsdE8, gasCostUsdE8 }
}

export interface SettlementInput {
  order: StoredOrder
  sourceRepayLeaf: MerkleLeaf
  sourceWithdrawLeaf: MerkleLeaf
  destDepositLeaf: MerkleLeaf
  destBorrowLeaf: MerkleLeaf
  /** Underlying collateral token (e.g. WETH) */
  collateralAsset: Address
  /** Underlying debt token (e.g. USDC) */
  debtAsset: Address
  /** User address — receives aTokens / debt on the dest protocol */
  user: Address
  /** Settlement contract address */
  settlement: Address
  /** Morpho Blue pool address (chain-specific flash loan provider) */
  morphoPool: Address
  /** Current debt in base units (from get_user_positions) */
  debtAmount: bigint
  /** Optional fee recipient for the solver */
  feeRecipient?: Address
}

/**
 * Builds the settleWithFlashLoan calldata from the chosen leaves.
 * Does NOT submit — returns the tx object for WDK sendTransaction.
 */
export function buildSettlementTx(input: SettlementInput): {
  to: Address
  data: Hex
  chainId: number
  flashAmount: bigint
  borrowAmount: bigint
} {
  // Add 0.01% buffer to cover interest accrued between calculation and execution
  const flashAmount = input.debtAmount + input.debtAmount / 10_000n + 1n

  // Borrow slightly more on dest: flash loan repayment + solver fee headroom
  const borrowAmount = flashAmount + (flashAmount * BigInt(input.order.order.maxFeeBps)) / 10_000_000n

  const executionData = encodeExecutionData(
    [
      // Pre 1: repay existing debt on source protocol
      {
        asset: input.debtAsset,
        amount: AmountSentinel.MAX,
        receiver: input.user,
        op: LenderOps.REPAY,
        lender: input.sourceRepayLeaf.lender,
        data: input.sourceRepayLeaf.data,
        proof: input.sourceRepayLeaf.proof,
      },
      // Pre 2: withdraw collateral from source protocol → settlement contract
      {
        asset: input.collateralAsset,
        amount: AmountSentinel.MAX,
        receiver: input.settlement,
        op: LenderOps.WITHDRAW,
        lender: input.sourceWithdrawLeaf.lender,
        data: input.sourceWithdrawLeaf.data,
        proof: input.sourceWithdrawLeaf.proof,
      },
    ],
    [
      // Post 1: deposit collateral on dest protocol for user
      {
        asset: input.collateralAsset,
        amount: AmountSentinel.BALANCE,
        receiver: input.user,
        op: LenderOps.DEPOSIT,
        lender: input.destDepositLeaf.lender,
        data: input.destDepositLeaf.data,
        proof: input.destDepositLeaf.proof,
      },
      // Post 2: borrow on dest protocol → settlement contract (repays flash loan)
      {
        asset: input.debtAsset,
        amount: borrowAmount,
        receiver: input.settlement,
        op: LenderOps.BORROW,
        lender: input.destBorrowLeaf.lender,
        data: input.destBorrowLeaf.data,
        proof: input.destBorrowLeaf.proof,
      },
    ],
    input.feeRecipient,
  )

  const settlementCall = encodeFunctionData({
    abi: settleWithFlashLoanAbi,
    functionName: 'settleWithFlashLoan',
    args: [
      input.debtAsset,
      flashAmount,
      input.morphoPool,
      0,                                       // poolId 0 = Morpho Blue
      BigInt(input.order.order.maxFeeBps),
      (input.order.order as any).solver ?? '0x0000000000000000000000000000000000000000',
      input.order.order.deadline,
      input.order.signature,
      input.order.order.orderData,             // signed by user, used as-is
      executionData,                           // rebuilt for chosen leaves
      '0x',                                    // no filler calldata (same-asset migration)
    ],
  })

  // Build multicall if there are permits or approvals to bundle
  const permits = input.order.order.permits ?? []
  const permitCalls = permits.map(p =>
    encodePermitCall(p, input.user, input.settlement),
  )
  const approvalCalls = deriveApprovalCalls(input.order.order.leaves)

  const allCalls = [...permitCalls, ...approvalCalls, settlementCall]

  // If there are extra calls to bundle, wrap in multicall; otherwise send bare
  let data: Hex
  if (allCalls.length > 1) {
    data = encodeFunctionData({
      abi: MULTICALL_ABI,
      functionName: 'multicall',
      args: [allCalls],
    })
  } else {
    data = settlementCall
  }

  return { to: input.settlement, data, chainId: input.order.order.chainId, flashAmount, borrowAmount }
}

/**
 * Builds and submits the settlement transaction via WDK sendTransaction.
 * Returns the transaction hash, or 'SKIPPED_NOT_ECONOMIC' if ECONOMIC_MODE
 * is enabled and the estimated gas cost exceeds the solver fee.
 */
export async function executeSettlement(
  wdkClient: Client,
  input: SettlementInput,
): Promise<string> {
  const tx = buildSettlementTx(input)

  console.log('\n=== Settlement Tx ===')
  console.log(`  chainId:       ${tx.chainId}`)
  console.log(`  to:            ${tx.to}`)
  console.log(`  flashAmount:   ${tx.flashAmount}`)
  console.log(`  borrowAmount:  ${tx.borrowAmount}`)
  console.log(`  debtAsset:     ${input.debtAsset}`)
  console.log(`  collateral:    ${input.collateralAsset}`)
  console.log(`  source lender: ${input.sourceRepayLeaf.lender}`)
  console.log(`  dest lender:   ${input.destDepositLeaf.lender}`)

  if (ECONOMIC_MODE) {
    const chainContracts = CONTRACTS_BY_CHAIN[input.order.order.chainId]
    const fromAddress = input.feeRecipient ?? input.user
    console.log('\n[Economic check] Estimating gas vs solver fee…')
    try {
      const rpcUrl = RPC_URL_BY_CHAIN[tx.chainId]
      if (!rpcUrl) throw new Error('RPC not found')

      const check = await checkEconomicViability(
        input,
        { to: tx.to, data: tx.data },
        tx.flashAmount,
        chainContracts.aaveOracle,
        fromAddress,
        rpcUrl
      )
      console.log(`  ${check.reason}`)
      if (!check.viable) {
        return 'SKIPPED_NOT_ECONOMIC'
      }
    } catch (err) {
      // If the check itself fails (e.g. RPC issue), skip rather than risk a loss
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`  Economic check failed (${msg}) — skipping to be safe`)
      return 'SKIPPED_NOT_ECONOMIC'
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Not submitting. Calldata:')
    console.log(tx.data.slice(0, 200) + '…')
    return 'DRY_RUN'
  }

  const result = await callTool(wdkClient, 'sendTransaction', {
    to: tx.to,
    data: tx.data,
    value: '0x0',
    chainId: tx.chainId,
  })

  console.log('  tx result:', result)
  return result
}
