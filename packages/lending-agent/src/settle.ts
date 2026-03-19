/**
 * Settlement transaction builder and submitter.
 *
 * Takes an already-decided source/dest leaf selection and builds the
 * settleWithFlashLoan calldata from the stored leaf proofs, then submits
 * via WDK sendTransaction.
 */

import { encodeFunctionData } from 'viem'
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
import { DRY_RUN } from './config.js'

// Morpho Blue is the flash loan provider — same address on all supported chains
const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as Address

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
 * Returns the transaction hash.
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
