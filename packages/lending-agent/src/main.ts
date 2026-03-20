import type Anthropic from '@anthropic-ai/sdk'
import { CONTRACTS_BY_CHAIN } from './config.js'
import { callTool, toAnthropicTools, createRouter } from './mcp.js'
import type { LocalHandler } from './mcp.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { buildSettlementSystemPrompt } from './prompt.js'
import { runAgentLoop } from './agent.js'
import { fetchOrder, fetchOpenOrders, markOrderFilled, describeLeaves } from './order.js'
import type { MerkleLeaf } from './order.js'
import { executeSettlement } from './settle.js'
import type { Address } from 'viem'

export interface AgentClients {
  oneDeltaClient: Client
  wdkClient: Client
}

/**
 * Full settlement flow:
 *   1. Fetch StoredOrder from order backend
 *   2. Decode all leaves and describe them for the agent
 *   3. Agent fetches positions + rates and calls propose_migration
 *   4. TypeScript builds executionData from chosen leaves and submits via WDK
 */
export async function runSettlementFlow(
  clients: AgentClients,
  orderId: string,
  chainId: number,
): Promise<string> {
  const { oneDeltaClient, wdkClient } = clients
  const settlement = CONTRACTS_BY_CHAIN[chainId].settlement
  if (!settlement) throw new Error('SETTLEMENT CONTRACT ADDRESS is required')

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
      : ''
    console.log(`  [${l.index}] ${l.op} ${l.protocol} ${extra}`)
  })

  // ── Tools ────────────────────────────────────────────────
  const [{ tools: oneDeltaTools }, { tools: wdkTools }] = await Promise.all([
    oneDeltaClient.listTools(),
    wdkClient.listTools(),
  ])

  const oneDeltaNeeded = new Set(['get_user_positions', 'find_market', 'get_lender_ids'])
  const wdkNeeded = new Set(['getAddress'])

  const filteredOneDelta = oneDeltaTools.filter(t => oneDeltaNeeded.has(t.name))
  const filteredWdk = wdkTools.filter(t => wdkNeeded.has(t.name))

  const toolClientMap = Object.fromEntries([
    ...filteredOneDelta.map(t => [t.name, oneDeltaClient] as const),
    ...filteredWdk.map(t => [t.name, wdkClient] as const),
  ])

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
      debtAmountBaseUnits:     String(input.debtAmountBaseUnits),
      reason:                  String(input.reason),
    } as MigrationDecision
    console.log('\n→ Agent proposed migration:', migrationDecision.reason)
    return 'Migration proposal recorded. Proceeding to build and submit settlement transaction.'
  }

  const proposeMigrationTool: Anthropic.Tool = {
    name: 'propose_migration',
    description: 'Submit the chosen migration once you have determined the best source→dest option. Call this exactly once.',
    input_schema: {
      type: 'object' as const,
      properties: {
        sourceRepayLeafIndex:    { type: 'number',  description: 'Index of the REPAY leaf for the source protocol' },
        sourceWithdrawLeafIndex: { type: 'number',  description: 'Index of the WITHDRAW leaf for the source protocol' },
        destDepositLeafIndex:    { type: 'number',  description: 'Index of the DEPOSIT leaf for the destination protocol' },
        destBorrowLeafIndex:     { type: 'number',  description: 'Index of the BORROW leaf for the destination protocol' },
        collateralAsset:         { type: 'string',  description: 'Underlying collateral token address (from get_user_positions)' },
        debtAsset:               { type: 'string',  description: 'Underlying debt token address (from get_user_positions)' },
        debtAmountBaseUnits:     { type: 'string',  description: 'Current debt amount in base units as a string' },
        reason:                  { type: 'string',  description: 'Why this is the best option (rates comparison)' },
      },
      required: [
        'sourceRepayLeafIndex', 'sourceWithdrawLeafIndex',
        'destDepositLeafIndex', 'destBorrowLeafIndex',
        'collateralAsset', 'debtAsset', 'debtAmountBaseUnits', 'reason',
      ],
    },
  }

  // ── Wallet address ───────────────────────────────────────
  let walletAddress = ''
  try {
    walletAddress = await callTool(wdkClient, 'getAddress', { chain: 'ethereum' })
  } catch (err) {
    console.warn('Could not fetch wallet address:', err instanceof Error ? err.message : err)
  }

  // ── Run agent ────────────────────────────────────────────
  const allTools: Anthropic.Tool[] = [
    ...toAnthropicTools(filteredOneDelta),
    ...toAnthropicTools(filteredWdk),
    proposeMigrationTool,
  ]

  const systemPrompt = buildSettlementSystemPrompt(walletAddress, chainId, leafDescriptions)
  const userMessage = `Analyze the available leaves for order ${orderId} on chain ${chainId} and find the best migration to execute.`

  const router = createRouter(toolClientMap, { propose_migration: proposeMigration })
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]
  const finalResponse = await runAgentLoop(router, systemPrompt, allTools, messages)

  const resultText = finalResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

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


