import { CONTRACTS_BY_CHAIN } from './config.js'
import { callTool, createRouter } from './mcp.js'
import type { LocalHandler } from './mcp.js'
import type { GenericTool } from './providers/index.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { buildSettlementSystemPrompt, buildFlatOptions } from './prompt.js'
import { runAgentLoop } from './agent.js'
import { fetchOrder, fetchOpenOrders, markOrderFilled, describeLeaves } from './order.js'
import type { MerkleLeaf } from './order.js'
import { buildSettlementContext } from './context.js'
import { executeSettlement } from './settle.js'
import { runPortfolioManagement } from './portfolioAgent.js'
import type { Address } from 'viem'

export interface AgentClients {
  oneDeltaClient: Client
  wdkClient: Client
}

/**
 * Full settlement flow:
 *   1. Fetch StoredOrder from order backend
 *   2. Decode all leaves
 *   3. TypeScript pre-processes: fetch positions + rates → SettlementContext
 *   4. Agent receives structured options and calls propose_migration
 *   5. TypeScript builds executionData and submits via WDK
 */
export async function runSettlementFlow(
  clients: AgentClients,
  orderId: string,
  chainId: number,
  forceMigration = false,
): Promise<string> {
  const { oneDeltaClient, wdkClient } = clients
  const chainContracts = CONTRACTS_BY_CHAIN[chainId]
  const settlement = chainContracts.settlement
  const morphoPool = chainContracts.morphoPool
  if (!settlement) throw new Error('SETTLEMENT CONTRACT ADDRESS is required')
  if (!morphoPool) throw new Error('MORPHO POOL ADDRESS is required')

  // ── Fetch order ──────────────────────────────────────────
  console.log(`\nFetching order ${orderId}…`)
  const order = await fetchOrder(orderId, chainId)
  console.log(`  signer: ${order.signer}  leaves: ${order.order.leaves.length}  status: ${order.status}`)

  if (order.status !== 'open') throw new Error(`Order ${orderId} is ${order.status}`)

  const leaves = order.order.leaves
  const leafDescriptions = describeLeaves(leaves)

  console.log('\nLeaves:')
  leafDescriptions.forEach(l => {
    const parts: string[] = []
    if (l.pool)            parts.push(`pool=${l.pool}`)
    if (l.aToken)          parts.push(`aToken=${l.aToken}`)
    if (l.vToken)          parts.push(`vToken=${l.vToken}`)
    if (l.comet)           parts.push(`comet=${l.comet}`)
    if (l.loanToken)       parts.push(`loanToken=${l.loanToken}`)
    if (l.collateralToken) parts.push(`collateralToken=${l.collateralToken}`)
    if (l.lltv !== undefined) parts.push(`lltv=${l.lltv}`)
    if (l.oracle)            parts.push(`oracle=${l.oracle}`)
    if (l.morpho)            parts.push(`morpho=${l.morpho}`)
    const extra = parts.join('  ')
    console.log(`  [${l.index}] ${l.op} ${l.protocol}  ${extra}`)
  })

  // ── Pre-process: build settlement context ────────────────
  console.log('\nBuilding settlement context…')
  const ctx = await buildSettlementContext(order, chainId, leafDescriptions, oneDeltaClient)

  if (!ctx) {
    console.log('No viable settlement context — skipping order.')
    return 'SKIPPED_NO_CONTEXT'
  }

  if (ctx.options.every(o => o.destinations.length === 0)) {
    console.log('No destination options available — skipping order.')
    return 'SKIPPED_NO_DESTINATIONS'
  }

  // ── Wallet address ───────────────────────────────────────
  let walletAddress = ''
  try {
    const raw = await callTool(wdkClient, 'getAddress', { chain: 'ethereum' })
    // WDK may return "Address: 0x..." — extract the raw hex address
    const match = raw.match(/0x[0-9a-fA-F]{40}/)
    walletAddress = match ? match[0] : raw
  } catch (err) {
    console.warn('Could not fetch wallet address:', err instanceof Error ? err.message : err)
  }

  // ── Flat option list (one entry per source→dest pair) ────
  // Filter to only options with a strictly positive improvement — no point migrating otherwise.
  // Set FORCE_MIGRATION=true to bypass this for live testing.
  const allFlatOptions = buildFlatOptions(ctx)
  const flatOptions = forceMigration
    ? allFlatOptions
    : allFlatOptions.filter(o => o.destination.improvement !== null && o.destination.improvement > 0)

  if (flatOptions.length === 0) {
    console.log('No migration options with positive improvement — skipping order.')
    return 'SKIPPED_NO_IMPROVEMENT'
  }

  // ── propose_migration local tool ─────────────────────────
  interface MigrationDecision {
    sourceRepayLeafIndex: number
    sourceWithdrawLeafIndex: number
    destDepositLeafIndex: number
    destBorrowLeafIndex: number
    collateralAsset: Address
    debtAsset: Address
    debtAmountBaseUnits: string
    reason: string
  }
  let migrationDecision: MigrationDecision | null = null

  const proposeMigration: LocalHandler = async (input) => {
    const optIdx = Number(input.optionIndex)
    const chosen = flatOptions[optIdx]
    if (!chosen) {
      return `Invalid optionIndex ${optIdx}. Valid range: 0–${flatOptions.length - 1}.`
    }
    migrationDecision = {
      sourceRepayLeafIndex:    chosen.source.group.repayLeafIndex!,
      sourceWithdrawLeafIndex: chosen.source.group.withdrawLeafIndex!,
      destDepositLeafIndex:    chosen.destination.group.depositLeafIndex!,
      destBorrowLeafIndex:     chosen.destination.group.borrowLeafIndex!,
      collateralAsset:         chosen.source.collateralToken,
      debtAsset:               chosen.source.debtToken,
      debtAmountBaseUnits:     chosen.source.debtAmountBaseUnits,
      reason:                  String(input.reason),
    }
    console.log('\n→ Agent proposed migration:', migrationDecision.reason)
    return 'Migration proposal recorded. Proceeding to build and submit settlement transaction.'
  }

  const proposeMigrationTool: GenericTool = {
    name: 'propose_migration',
    description: 'Submit the chosen migration option by its index. Call this exactly once.',
    inputSchema: {
      type: 'object',
      properties: {
        optionIndex: { type: 'number', description: 'The index of the chosen OPTION from the list (0, 1, 2, …)' },
        reason:      { type: 'string', description: 'One-line explanation naming the protocols and improvement value' },
      },
      required: ['optionIndex', 'reason'],
    },
  }

  // ── Run agent ────────────────────────────────────────────
  const allTools: GenericTool[] = [proposeMigrationTool]

  const systemPrompt = buildSettlementSystemPrompt(walletAddress, ctx, flatOptions)
  const userMessage = `Analyze the pre-computed settlement context for order ${orderId} on chain ${chainId} and execute the best migration.`

  const router = createRouter({}, { propose_migration: proposeMigration })
  const resultText = await runAgentLoop(router, systemPrompt, allTools, userMessage)

  console.log('\n=== Agent Result ===')
  console.log(resultText)

  // ── Execute settlement ───────────────────────────────────
  if (!migrationDecision) {
    console.log('\nAgent did not propose a migration — no action taken.')
    return resultText
  }

  const d = migrationDecision as MigrationDecision

  const srcRepayLeaf   = leaves[d.sourceRepayLeafIndex]   as MerkleLeaf
  const srcWithdrawLeaf = leaves[d.sourceWithdrawLeafIndex] as MerkleLeaf
  const dstDepositLeaf  = leaves[d.destDepositLeafIndex]    as MerkleLeaf
  const dstBorrowLeaf   = leaves[d.destBorrowLeafIndex]     as MerkleLeaf

  console.log('\n=== Leaves selected ===')
  console.log(`  sourceRepay   [${d.sourceRepayLeafIndex}]: lender=${srcRepayLeaf?.lender}  proofLen=${srcRepayLeaf?.proof?.length ?? 0}  data=${String(srcRepayLeaf?.data).slice(0, 20)}…`)
  console.log(`  sourceWithdraw[${d.sourceWithdrawLeafIndex}]: lender=${srcWithdrawLeaf?.lender}  proofLen=${srcWithdrawLeaf?.proof?.length ?? 0}  data=${String(srcWithdrawLeaf?.data).slice(0, 20)}…`)
  console.log(`  destDeposit   [${d.destDepositLeafIndex}]: lender=${dstDepositLeaf?.lender}  proofLen=${dstDepositLeaf?.proof?.length ?? 0}  data=${String(dstDepositLeaf?.data).slice(0, 20)}…`)
  console.log(`  destBorrow    [${d.destBorrowLeafIndex}]: lender=${dstBorrowLeaf?.lender}  proofLen=${dstBorrowLeaf?.proof?.length ?? 0}  data=${String(dstBorrowLeaf?.data).slice(0, 20)}…`)

  const txHash = await executeSettlement(wdkClient, {
    order,
    sourceRepayLeaf:   srcRepayLeaf,
    sourceWithdrawLeaf: srcWithdrawLeaf,
    destDepositLeaf:   dstDepositLeaf,
    destBorrowLeaf:    dstBorrowLeaf,
    collateralAsset: d.collateralAsset,
    debtAsset: d.debtAsset,
    user: order.signer,
    settlement,
    morphoPool,
    debtAmount: BigInt(d.debtAmountBaseUnits),
    feeRecipient: walletAddress as Address || undefined,
  })

  // Mark filled after successful on-chain submission
  if (txHash !== 'DRY_RUN' && txHash !== 'SKIPPED_NOT_ECONOMIC') {
    // await markOrderFilled(orderId, chainId)
    console.log(`  Order ${orderId} marked as filled.`)
  }

  return txHash
}

/**
 * Fetches all open orders for a chain and runs the settlement flow on each.
 * Orders are processed sequentially to avoid nonce conflicts on the wallet.
 * Failed orders are logged and skipped — processing continues.
 */
export async function runAllSettlements(
  clients: AgentClients,
  chainId: number,
  forceMigration = false,
): Promise<{ orderId: string; result: string }[]> {
  console.log(`\nFetching open orders for chain ${chainId}…`)
  const orders = await fetchOpenOrders(chainId)
  console.log(`  Found ${orders.length} open order(s).`)

  const results: { orderId: string; result: string }[] = []

  for (const order of orders) {
    console.log(`\n─── Processing order ${order.id} ───`)
    try {
      const result = await runSettlementFlow(clients, order.id, chainId, forceMigration)
      results.push({ orderId: order.id, result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  Error processing order ${order.id}: ${msg}`)
      results.push({ orderId: order.id, result: `ERROR: ${msg}` })
    }
  }

  return results
}

/**
 * Full cycle: settle all open orders, then run portfolio management.
 * This is the recommended entry point for the cron job / server.
 */
export async function runFullCycle(
  clients: AgentClients,
  chainId: number,
  forceMigration = false,
): Promise<void> {
  await runAllSettlements(clients, chainId, forceMigration)
  await runPortfolioManagement(clients.wdkClient, chainId)
}
