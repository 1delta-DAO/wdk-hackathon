import { CONTRACTS_BY_CHAIN } from './config.js'
import { callTool, createRouter } from './mcp.js'
import type { LocalHandler } from './mcp.js'
import type { GenericTool } from './providers/index.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { buildSettlementSystemPrompt } from './prompt.js'
import { runAgentLoop } from './agent.js'
import { fetchOrder, fetchOpenOrders, markOrderFilled, describeLeaves } from './order.js'
import type { MerkleLeaf } from './order.js'
import { buildSettlementContext } from './context.js'
import { executeSettlement } from './settle.js'
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
    const extra = l.pool ? `pool=${l.pool.slice(0, 10)}…`
      : l.loanToken ? `loan=${l.loanToken.slice(0, 10)}… coll=${l.collateralToken?.slice(0, 10)}… lltv=${l.lltv}`
      : l.comet ? `comet=${l.comet.slice(0, 10)}…`
      : ''
    console.log(`  [${l.index}] ${l.op} ${l.protocol} ${extra}`)
  })

  // ── Pre-process: build settlement context ────────────────
  console.log('\nBuilding settlement context…')
  const ctx = await buildSettlementContext(order, chainId, leafDescriptions, oneDeltaClient)

  if (!ctx) {
    console.log('No viable settlement context — skipping order.')
    return 'SKIPPED_NO_CONTEXT'
  }

  if (ctx.destinations.length === 0) {
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
    migrationDecision = {
      sourceRepayLeafIndex:    Number(input.sourceRepayLeafIndex),
      sourceWithdrawLeafIndex: Number(input.sourceWithdrawLeafIndex),
      destDepositLeafIndex:    Number(input.destDepositLeafIndex),
      destBorrowLeafIndex:     Number(input.destBorrowLeafIndex),
      collateralAsset:         String(input.collateralAsset) as Address,
      debtAsset:               String(input.debtAsset) as Address,
      // Always use pre-computed base units from context — agent may hallucinate this value
      debtAmountBaseUnits:     ctx.source.debtAmountBaseUnits,
      reason:                  String(input.reason),
    } as MigrationDecision
    console.log('\n→ Agent proposed migration:', migrationDecision.reason)
    return 'Migration proposal recorded. Proceeding to build and submit settlement transaction.'
  }

  const proposeMigrationTool: GenericTool = {
    name: 'propose_migration',
    description: 'Submit the chosen migration once you have determined the best source→dest option. Call this exactly once.',
    inputSchema: {
      type: 'object',
      properties: {
        sourceRepayLeafIndex:    { type: 'number',  description: 'Index of the REPAY leaf for the source protocol' },
        sourceWithdrawLeafIndex: { type: 'number',  description: 'Index of the WITHDRAW leaf for the source protocol' },
        destDepositLeafIndex:    { type: 'number',  description: 'Index of the DEPOSIT leaf for the destination protocol' },
        destBorrowLeafIndex:     { type: 'number',  description: 'Index of the BORROW leaf for the destination protocol' },
        collateralAsset:         { type: 'string',  description: 'Underlying collateral token address' },
        debtAsset:               { type: 'string',  description: 'Underlying debt token address' },
        reason:                  { type: 'string',  description: 'Why this is the best option (rates comparison)' },
      },
      required: [
        'sourceRepayLeafIndex', 'sourceWithdrawLeafIndex',
        'destDepositLeafIndex', 'destBorrowLeafIndex',
        'collateralAsset', 'debtAsset', 'reason',
      ],
    },
  }

  // ── Run agent ────────────────────────────────────────────
  const allTools: GenericTool[] = [proposeMigrationTool]

  const systemPrompt = buildSettlementSystemPrompt(walletAddress, ctx)
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
  const txHash = await executeSettlement(wdkClient, {
    order,
    sourceRepayLeaf: leaves[d.sourceRepayLeafIndex] as MerkleLeaf,
    sourceWithdrawLeaf: leaves[d.sourceWithdrawLeafIndex] as MerkleLeaf,
    destDepositLeaf: leaves[d.destDepositLeafIndex] as MerkleLeaf,
    destBorrowLeaf: leaves[d.destBorrowLeafIndex] as MerkleLeaf,
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
    await markOrderFilled(orderId, chainId)
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
): Promise<{ orderId: string; result: string }[]> {
  console.log(`\nFetching open orders for chain ${chainId}…`)
  const orders = await fetchOpenOrders(chainId)
  console.log(`  Found ${orders.length} open order(s).`)

  const results: { orderId: string; result: string }[] = []

  for (const order of orders) {
    console.log(`\n─── Processing order ${order.id} ───`)
    try {
      const result = await runSettlementFlow(clients, order.id, chainId)
      results.push({ orderId: order.id, result })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`  Error processing order ${order.id}: ${msg}`)
      results.push({ orderId: order.id, result: `ERROR: ${msg}` })
    }
  }

  return results
}
