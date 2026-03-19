import type Anthropic from '@anthropic-ai/sdk'
import { TOKEN, AMOUNT, CHAIN_FILTER, DRY_RUN, SETTLEMENT_ADDRESS } from './config.js'
import { connectOneDelta, connectWdk, callTool, toAnthropicTools, createRouter } from './mcp.js'
import type { LocalHandler } from './mcp.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { buildSystemPrompt, buildIntentSystemPrompt, buildSettlementSystemPrompt } from './prompt.js'
import { runAgentLoop } from './agent.js'
import { fetchOrder, describeLeaves } from './order.js'
import type { MerkleLeaf } from './order.js'
import { executeSettlement } from './settle.js'
import type { Address } from 'viem'

export interface AgentClients {
  oneDeltaClient: Client
  wdkClient: Client
}

/**
 * Represents a user's signed lending intent — derived from the StoredOrder
 * in the order-backend. The agent uses this to constrain its market search.
 *
 * collateralToken / debtToken may be empty when derived from orderToIntent().
 * The agent resolves them from get_user_positions using the signer's address.
 */
export interface LendingIntent {
  /** EIP-712 signature from the user over this intent — validated onchain */
  signature: string
  /** Order ID in the backend — used to mark the order filled after execution */
  orderId?: string
  /** Chain to optimize the position on */
  chainId: number
  /**
   * Token address the user is supplying as collateral.
   * Empty string when derived from orderToIntent() — agent resolves via get_user_positions.
   */
  collateralToken: string
  /**
   * Token address the user wants to borrow. Optional — if absent, deposit-only.
   * Empty string when derived from orderToIntent() — agent resolves via get_user_positions.
   */
  debtToken: string
  /** 1delta lender ID strings the user permits — agent must not select outside this set */
  allowedLenders: string[]
  /**
   * USD amount to deposit as collateral.
   * Optional — if absent the agent resolves the amount from the current position size.
   */
  usdAmount?: string
}

export async function runAgentWithIntent (clients: AgentClients, intent: LendingIntent): Promise<string> {
  const { oneDeltaClient, wdkClient } = clients

  const [{ tools: oneDeltaTools }, { tools: wdkTools }] = await Promise.all([
    oneDeltaClient.listTools(),
    wdkClient.listTools(),
  ])

  const oneDeltaNeeded = new Set([
    'get_user_positions',  // inspect existing deposits/borrows before optimizing
    'find_market',
    'convert_amount',
    'get_deposit_calldata',
    ...(intent.debtToken ? ['get_borrow_calldata'] : []),
    'get_lender_ids',      // agent may need this to resolve lender IDs
  ])
  const wdkNeeded = new Set(['getAddress', 'sendTransaction'])

  const filteredOneDelta = oneDeltaTools.filter(t => oneDeltaNeeded.has(t.name))
  const filteredWdk = wdkTools.filter(t => wdkNeeded.has(t.name))

  const toolClientMap = Object.fromEntries([
    ...filteredOneDelta.map(t => [t.name, oneDeltaClient] as const),
    ...filteredWdk.map(t => [t.name, wdkClient] as const),
  ])

  const allTools: Anthropic.Tool[] = [
    ...toAnthropicTools(filteredOneDelta),
    ...toAnthropicTools(filteredWdk),
  ]

  let walletAddress = ''
  try {
    walletAddress = await callTool(wdkClient, 'getAddress', { chain: 'ethereum' })
  } catch (err) {
    console.warn('Could not fetch wallet address:', err instanceof Error ? err.message : err)
  }

  const systemPrompt = buildIntentSystemPrompt(walletAddress, intent)
  const userMessage = [
    `Optimize a lending position on chain ${intent.chainId}.`,
    `Collateral token: ${intent.collateralToken}`,
    intent.debtToken ? `Debt token: ${intent.debtToken}` : null,
    `Allowed lenders: ${intent.allowedLenders.join(', ')}`,
  ].filter(Boolean).join('\n')

  console.log(`\nIntent task:\n${userMessage}\n`)

  const router = createRouter(toolClientMap)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]
  const finalResponse = await runAgentLoop(router, systemPrompt, allTools, messages)

  const resultText = finalResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  console.log('\n=== Agent Result ===')
  console.log(resultText)

  return resultText
}

export async function runAgent (clients: AgentClients): Promise<string> {
  const { oneDeltaClient, wdkClient } = clients

  const [{ tools: oneDeltaTools }, { tools: wdkTools }] = await Promise.all([
    oneDeltaClient.listTools(),
    wdkClient.listTools(),
  ])

  console.log(`\n1delta tools (${oneDeltaTools.length}): ${oneDeltaTools.map(t => t.name).join(', ')}`)
  console.log(`WDK tools    (${wdkTools.length}): ${wdkTools.map(t => t.name).join(', ')}`)

  const ONEDELTA_TOOLS_NEEDED = new Set(['get_lending_markets', 'convert_amount', 'get_deposit_calldata'])
  const WDK_TOOLS_NEEDED = new Set(['getAddress', 'sendTransaction'])

  const filteredOneDelta = oneDeltaTools.filter(t => ONEDELTA_TOOLS_NEEDED.has(t.name))
  const filteredWdk = wdkTools.filter(t => WDK_TOOLS_NEEDED.has(t.name))

  const toolClientMap = Object.fromEntries([
    ...filteredOneDelta.map(t => [t.name, oneDeltaClient] as const),
    ...filteredWdk.map(t => [t.name, wdkClient] as const)
  ])

  const allTools: Anthropic.Tool[] = [
    ...toAnthropicTools(filteredOneDelta),
    ...toAnthropicTools(filteredWdk)
  ]

  let walletAddress = ''
  try {
    walletAddress = await callTool(wdkClient, 'getAddress', { chain: 'ethereum' })
    console.log(`\nWallet address (ethereum): ${walletAddress}`)
  } catch (err) {
    console.warn('Could not fetch wallet address from WDK:', err instanceof Error ? err.message : err)
  }

  const systemPrompt = buildSystemPrompt(walletAddress)
  const chainNote = CHAIN_FILTER ? ` on chain ${CHAIN_FILTER}` : ' across all supported chains'
  const userMessage = `Find the best ${TOKEN} lending market${chainNote} and deposit ${AMOUNT} USD worth of ${TOKEN} using my wallet.`

  console.log(`\nUser task: ${userMessage}\n`)

  const router = createRouter(toolClientMap)
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: userMessage }]
  const finalResponse = await runAgentLoop(router, systemPrompt, allTools, messages)

  const resultText = finalResponse.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map(b => b.text)
    .join('')

  console.log('\n=== Agent Result ===')
  console.log(resultText)

  return resultText
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
  settlementAddress?: string,
): Promise<string> {
  const { oneDeltaClient, wdkClient } = clients
  const settlement = (settlementAddress ?? SETTLEMENT_ADDRESS) as Address
  if (!settlement) throw new Error('SETTLEMENT_ADDRESS is required')

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

  return txHash
}

export async function main (): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is required')
  }

  const model = process.env.MODEL ?? 'claude-opus-4-6'
  console.log('=== 1delta × WDK Lending Agent ===')
  console.log(`Token: ${TOKEN}  |  Amount: ${AMOUNT}  |  DryRun: ${DRY_RUN}  |  Model: ${model}`)
  if (CHAIN_FILTER) console.log(`Chain filter: ${CHAIN_FILTER}`)
  console.log()

  console.log('Connecting to 1delta MCP…')
  const oneDeltaClient = await connectOneDelta()
  console.log('  connected.')

  console.log('Connecting to WDK MCP…')
  const wdkClient = await connectWdk()
  console.log('  connected.')

  try {
    await runAgent({ oneDeltaClient, wdkClient })
  } finally {
    await Promise.allSettled([oneDeltaClient.close(), wdkClient.close()])
  }
}
