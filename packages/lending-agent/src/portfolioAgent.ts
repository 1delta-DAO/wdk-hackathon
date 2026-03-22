/**
 * Autonomous portfolio management agent.
 *
 * After each settlement batch the solver wallet holds earned USDT fees and
 * spends ETH on gas. This agent runs Claude against the current wallet state
 * and decides — autonomously — when to swap USDT→ETH to top up the gas
 * reserve, when to deposit idle USDT into Aave for yield, and whether to
 * hold wstETH for passive staking income.
 *
 * All execution goes through the WDK MCP client.
 */

import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import type { Address } from 'viem'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { callTool, createRouter, toGenericTools } from './mcp.js'
import type { GenericTool } from './providers/index.js'
import { runAgentLoop } from './agent.js'
import { buildPortfolioSystemPrompt } from './prompt.js'
import type { PortfolioState } from './prompt.js'
import { DRY_RUN, RPC_URL_BY_CHAIN, CONTRACTS_BY_CHAIN } from './config.js'

// ── Token addresses (Arbitrum One) ────────────────────────────────────────────

const USDT_ARB   = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address
const WSTETH_ARB = '0x5979D7b546E38E414F7E9822514be443A4800529' as Address
const WETH_ARB   = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address
const AUSDT_ARB  = '0x6ab707Aca953eDAeFBc4fD23bA73294241490620' as Address // Aave V3 aUSDT

const ERC20_BALANCE_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
])

const AAVE_ORACLE_ABI = parseAbi([
  'function getAssetPrice(address asset) external view returns (uint256)',
])

// ── State fetching ────────────────────────────────────────────────────────────

async function fetchPortfolioState(
  wdkClient: Client,
  chainId: number,
): Promise<PortfolioState> {
  // Resolve wallet address from WDK
  const raw = await callTool(wdkClient, 'getAddress', { chain: 'arbitrum' })
  const match = raw.match(/0x[0-9a-fA-F]{40}/)
  const walletAddress = (match ? match[0] : '') as Address

  const rpcUrl = RPC_URL_BY_CHAIN[chainId]
  const contracts = CONTRACTS_BY_CHAIN[chainId]
  const client = createPublicClient({ transport: http(rpcUrl) })

  // Read all balances + ETH price in parallel; individual failures return 0
  const [ethBal, usdtBal, wstethBal, ausdtBal, ethPriceRaw] = await Promise.all([
    client.getBalance({ address: walletAddress }).catch(() => 0n),
    client.readContract({ address: USDT_ARB,   abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [walletAddress] }).catch(() => 0n),
    client.readContract({ address: WSTETH_ARB, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [walletAddress] }).catch(() => 0n),
    client.readContract({ address: AUSDT_ARB,  abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [walletAddress] }).catch(() => 0n),
    client.readContract({ address: contracts.aaveOracle as Address, abi: AAVE_ORACLE_ABI, functionName: 'getAssetPrice', args: [WETH_ARB] }).catch(() => 0n),
  ])

  const ethPriceUsd   = Number(ethPriceRaw) / 1e8
  const ethBalFloat   = Number(formatUnits(ethBal,    18))
  const wstethFloat   = Number(formatUnits(wstethBal, 18))

  return {
    walletAddress,
    chainId,
    ethBalance:         formatUnits(ethBal,    18),
    ethUsd:             ethBalFloat * ethPriceUsd,
    usdtBalance:        formatUnits(usdtBal,    6),
    usdtUsd:            Number(formatUnits(usdtBal, 6)),
    wstethBalance:      formatUnits(wstethBal, 18),
    wstethUsd:          wstethFloat * ethPriceUsd,    // wstETH ≈ 1 ETH in USD
    aaveUsdtDeposited:  formatUnits(ausdtBal,   6),
    aaveUsdtUsd:        Number(formatUnits(ausdtBal, 6)),
    ethPriceUsd,
  }
}

// ── Agent loop ────────────────────────────────────────────────────────────────

interface PlannedAction {
  action: 'swap' | 'aave_supply' | 'aave_withdraw' | 'no_action'
  reason: string
  details?: string
}

const RECORD_ACTIONS_TOOL: GenericTool = {
  name: 'record_actions',
  description:
    'Record all planned portfolio actions before executing them. Call this exactly once with the complete action plan, then execute each action using the WDK tools.',
  inputSchema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['swap', 'aave_supply', 'aave_withdraw', 'no_action'],
            },
            reason:  { type: 'string', description: 'Why this action is needed (which strategy rule)' },
            details: { type: 'string', description: 'What specifically to do, e.g. "swap 20 USDT to ETH"' },
          },
          required: ['action', 'reason'],
        },
      },
    },
    required: ['actions'],
  },
}

export async function runPortfolioManagement(
  wdkClient: Client,
  chainId: number,
): Promise<void> {
  console.log('\n=== Portfolio Management ===')

  const state = await fetchPortfolioState(wdkClient, chainId)

  console.log(`  Wallet:       ${state.walletAddress}`)
  console.log(`  ETH:          ${Number(state.ethBalance).toFixed(6)} ETH  (~$${state.ethUsd.toFixed(2)})`)
  console.log(`  USDT:         ${Number(state.usdtBalance).toFixed(2)} USDT`)
  console.log(`  wstETH:       ${Number(state.wstethBalance).toFixed(6)} wstETH  (~$${state.wstethUsd.toFixed(2)})`)
  console.log(`  Aave USDT:    ${Number(state.aaveUsdtDeposited).toFixed(2)} aUSDT  (~$${state.aaveUsdtUsd.toFixed(2)})`)
  console.log(`  ETH price:    $${state.ethPriceUsd.toFixed(2)}`)

  // Discover all WDK tools dynamically so new WDK capabilities are picked up automatically
  const mcpTools = await wdkClient.listTools()
  const wdkTools = toGenericTools(mcpTools.tools)
  const allTools: GenericTool[] = [RECORD_ACTIONS_TOOL, ...wdkTools]

  // record_actions local handler — captures the plan so we can log it
  let plannedActions: PlannedAction[] = []
  const recordActionsHandler = async (input: Record<string, unknown>) => {
    plannedActions = (input.actions as PlannedAction[]) ?? []
    console.log('\n→ Portfolio plan:')
    for (const a of plannedActions) {
      console.log(`  [${a.action}] ${a.reason}${a.details ? ' — ' + a.details : ''}`)
    }
    return 'Actions recorded. Proceed to execute them one by one using the WDK tools.'
  }

  // In DRY_RUN mode, intercept WDK tool calls and print them without executing.
  // record_actions still runs so we capture the agent's reasoning.
  const wdkToolNames = new Set(wdkTools.map(t => t.name))
  const router = createRouter(
    DRY_RUN
      ? {} // no WDK client routing
      : Object.fromEntries(wdkTools.map(t => [t.name, wdkClient])),
    {
      record_actions: recordActionsHandler,
      // Wrap every WDK tool call in dry-run mode so the router doesn't throw
      ...( DRY_RUN
        ? Object.fromEntries(
            [...wdkToolNames].map(name => [
              name,
              async (input: Record<string, unknown>) => {
                console.log(`  [DRY RUN] ${name}(${JSON.stringify(input)})`)
                return `[DRY RUN] ${name} not executed.`
              },
            ])
          )
        : {}
      ),
    },
  )

  const systemPrompt = buildPortfolioSystemPrompt(state)
  const userMessage =
    'Review the current portfolio state and manage the treasury. ' +
    'Start by calling record_actions with your plan, then execute each action using the WDK tools.'

  const result = await runAgentLoop(router, systemPrompt, allTools, userMessage)

  if (plannedActions.length === 0) {
    console.log('\n  Agent did not call record_actions — no structured plan captured.')
  }

  console.log('\n=== Portfolio Agent Result ===')
  console.log(result)
}
