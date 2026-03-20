/**
 * Settlement transaction builder and submitter.
 *
 * Takes an already-decided source/dest leaf selection and builds the
 * settleWithFlashLoan calldata from the stored leaf proofs, then submits
 * via WDK sendTransaction.
 */

import { encodeFunctionData, createPublicClient, http, parseAbi } from 'viem'
import type { Hex, Address } from 'viem'
import {
  encodeExecutionData,
  AmountSentinel,
  LenderOps,
  settleWithFlashLoanAbi,
} from '@1delta/settlement-sdk'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { MerkleLeaf, StoredOrder } from './order.js'
import { callTool } from './mcp.js'
import { DRY_RUN, ECONOMIC_MODE, RPC_URL_BY_CHAIN, CONTRACTS_BY_CHAIN, CHAIN_NAMES } from './config.js'

// Morpho Blue is the flash loan provider — same address on all supported chains
const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as Address

// WETH on Arbitrum — used to price ETH gas costs via the Aave oracle
const WETH_ARB = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address

const AAVE_ORACLE_ABI = parseAbi([
  'function getAssetPrice(address asset) external view returns (uint256)',
])

const ERC20_ABI = parseAbi([
  'function decimals() external view returns (uint8)',
])

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

  const data = encodeFunctionData({
    abi: settleWithFlashLoanAbi,
    functionName: 'settleWithFlashLoan',
    args: [
      input.debtAsset,
      flashAmount,
      MORPHO_BLUE,
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

  const chain = CHAIN_NAMES[tx.chainId]
  if (!chain) throw new Error(`No chain name mapping for chainId ${tx.chainId}`)

  const result = await callTool(wdkClient, 'sendContractTransaction', {
    to: tx.to,
    data: tx.data,
    chain,
  })

  console.log('  tx result:', result)

  // Treat MCP errors and non-hex results as failures
  if (!result.startsWith('0x')) throw new Error(`sendTransaction failed: ${result}`)

  return result
}
