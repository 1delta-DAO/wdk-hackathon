import type Anthropic from '@anthropic-ai/sdk'
import { TOKEN, AMOUNT, CHAIN_FILTER, DRY_RUN } from './config.js'
import { connectOneDelta, connectWdk, callTool, toAnthropicTools, createRouter } from './mcp.js'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { buildSystemPrompt } from './prompt.js'
import { runAgentLoop } from './agent.js'

export interface AgentClients {
  oneDeltaClient: Client
  wdkClient: Client
}

export async function runAgent (clients: AgentClients): Promise<string> {
  const { oneDeltaClient, wdkClient } = clients

  const [{ tools: oneDeltaTools }, { tools: wdkTools }] = await Promise.all([
    oneDeltaClient.listTools(),
    wdkClient.listTools(),
  ])

  console.log(`\n1delta tools (${oneDeltaTools.length}): ${oneDeltaTools.map(t => t.name).join(', ')}`)
  console.log(`WDK tools    (${wdkTools.length}): ${wdkTools.map(t => t.name).join(', ')}`)

  const toolClientMap = Object.fromEntries([
    ...oneDeltaTools.map(t => [t.name, oneDeltaClient] as const),
    ...wdkTools.map(t => [t.name, wdkClient] as const)
  ])

  const allTools: Anthropic.Tool[] = [
    ...toAnthropicTools(oneDeltaTools),
    ...toAnthropicTools(wdkTools)
  ]

  let walletAddress = ''
  try {
    walletAddress = await callTool(wdkClient, 'getAddress', { blockchain: 'ethereum' })
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
