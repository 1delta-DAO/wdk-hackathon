/**
 * OpenClaw-style top-level orchestrator.
 *
 * Assesses current state (open orders + wallet health) and decides which
 * agents to activate each cycle:
 *   - run_settlements   → fill pending user loan migrations
 *   - run_portfolio     → rebalance solver treasury (gas, yield, wstETH)
 *   - skip_cycle        → do nothing this run
 *
 * Claude reasons about WHEN and WHY to act — not just how.
 */

import { createPublicClient, http, parseAbi, formatUnits } from 'viem'
import type { Address } from 'viem'
import { createRouter } from './mcp.js'
import type { GenericTool } from './providers/index.js'
import { runAgentLoop } from './agent.js'
import { fetchOpenOrders } from './order.js'
import { runAllSettlements } from './main.js'
import { runPortfolioManagement } from './portfolioAgent.js'
import { RPC_URL_BY_CHAIN, CONTRACTS_BY_CHAIN } from './config.js'
import { getWdkAddress } from './wdk.js'

const WETH_ARB  = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address
const USDT_ARB  = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address
const AUSDT_ARB = '0x6ab707Aca953eDAeFBc4fD23bA73294241490620' as Address

const ERC20_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
])
const AAVE_ORACLE_ABI = parseAbi([
  'function getAssetPrice(address asset) external view returns (uint256)',
])

// ── State snapshot ────────────────────────────────────────────────────────────

interface OrchestratorState {
  chainId: number
  openOrderCount: number
  walletAddress: string
  ethUsd: number
  usdtUsd: number
  aaveUsdtUsd: number
  ethPriceUsd: number
}

async function fetchOrchestratorState(chainId: number): Promise<OrchestratorState> {
  const seed = process.env.WDK_SEED ?? ''
  const rpcUrl = RPC_URL_BY_CHAIN[chainId]
  const walletAddress = seed ? await getWdkAddress(seed, rpcUrl) : '' as Address

  const contracts = CONTRACTS_BY_CHAIN[chainId]
  const client = createPublicClient({ transport: http(rpcUrl) })

  const [orders, ethBal, usdtBal, ausdtBal, ethPriceRaw] = await Promise.all([
    fetchOpenOrders(chainId).catch(() => []),
    client.getBalance({ address: walletAddress }).catch(() => 0n),
    client.readContract({ address: USDT_ARB,  abi: ERC20_ABI, functionName: 'balanceOf', args: [walletAddress] }).catch(() => 0n),
    client.readContract({ address: AUSDT_ARB, abi: ERC20_ABI, functionName: 'balanceOf', args: [walletAddress] }).catch(() => 0n),
    client.readContract({ address: contracts.aaveOracle as Address, abi: AAVE_ORACLE_ABI, functionName: 'getAssetPrice', args: [WETH_ARB] }).catch(() => 0n),
  ])

  const ethPriceUsd = Number(ethPriceRaw) / 1e8

  return {
    chainId,
    openOrderCount: orders.length,
    walletAddress,
    ethUsd:     Number(formatUnits(ethBal,    18)) * ethPriceUsd,
    usdtUsd:    Number(formatUnits(usdtBal,    6)),
    aaveUsdtUsd: Number(formatUnits(ausdtBal,  6)),
    ethPriceUsd,
  }
}

// ── System prompt ─────────────────────────────────────────────────────────────

function buildOrchestratorPrompt(s: OrchestratorState): string {
  const ethStatus = s.ethUsd < 5
    ? `⚠️  CRITICAL — below $5 minimum ($${s.ethUsd.toFixed(2)})`
    : `✅  healthy ($${s.ethUsd.toFixed(2)})`

  return `You are the orchestrator for an autonomous DeFi agent on Arbitrum.

Your job: decide which actions to take this cycle based on the current state.
You control two sub-agents — activate them in the right order by calling their tools.

CURRENT STATE:
  Chain:          Arbitrum (${s.chainId})
  Pending orders: ${s.openOrderCount} open loan migration order(s)
  Wallet ETH:     ${ethStatus}
  Wallet USDT:    $${s.usdtUsd.toFixed(2)}
  Aave USDT:      $${s.aaveUsdtUsd.toFixed(2)} (earning yield)
  ETH price:      $${s.ethPriceUsd.toFixed(2)}

AVAILABLE ACTIONS:
  run_settlements  — Fill all pending user orders. Earns USDT fees per settlement.
  run_portfolio    — Rebalance solver treasury: top up ETH gas reserve, deploy idle USDT to Aave for yield.
  skip_cycle       — Take no action. Use only when everything is healthy and no orders are pending.

DECISION RULES (apply in order):
1. ETH < $5 AND USDT available → run_portfolio FIRST (swap USDT→ETH), THEN run_settlements
2. Pending orders > 0 AND ETH ≥ $5 → run_settlements
3. Pending orders = 0 AND (USDT > $20 OR ETH imbalanced) → run_portfolio
4. Everything healthy, no orders → skip_cycle

For each action you call, provide a clear REASON explaining which rule triggered it.
You may call both run_settlements AND run_portfolio in the same cycle if needed.`
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const RUN_SETTLEMENTS_TOOL: GenericTool = {
  name: 'run_settlements',
  description: 'Activate the settlement sub-agent to fill all pending user loan migration orders on the given chain.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why settlements should run this cycle' },
    },
    required: ['reason'],
  },
}

const RUN_PORTFOLIO_TOOL: GenericTool = {
  name: 'run_portfolio',
  description: 'Activate the portfolio management sub-agent to rebalance the solver treasury (gas reserve, Aave yield, wstETH).',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why portfolio management should run this cycle' },
    },
    required: ['reason'],
  },
}

const SKIP_CYCLE_TOOL: GenericTool = {
  name: 'skip_cycle',
  description: 'Skip this cycle — everything is healthy and no action is needed.',
  inputSchema: {
    type: 'object',
    properties: {
      reason: { type: 'string', description: 'Why no action is needed' },
    },
    required: ['reason'],
  },
}

// ── Orchestrator entry point ──────────────────────────────────────────────────

export async function runOrchestrator(
  chainId: number,
  forceMigration = false,
): Promise<void> {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║      Orchestrator — Cycle Start      ║')
  console.log('╚══════════════════════════════════════╝')

  const state = await fetchOrchestratorState(chainId)

  console.log(`  Open orders: ${state.openOrderCount}`)
  console.log(`  ETH:         $${state.ethUsd.toFixed(2)}`)
  console.log(`  USDT:        $${state.usdtUsd.toFixed(2)}`)
  console.log(`  Aave USDT:   $${state.aaveUsdtUsd.toFixed(2)}`)

  const runSettlementsHandler = async (input: Record<string, unknown>) => {
    console.log(`\n[Orchestrator] → run_settlements: ${input.reason}`)
    const results = await runAllSettlements(chainId, forceMigration)
    const summary = results.map(r => `  ${r.orderId}: ${r.result}`).join('\n')
    console.log(`  Settlements complete — ${results.length} order(s) processed`)
    return `Settlements complete:\n${summary || '  (no orders processed)'}`
  }

  const runPortfolioHandler = async (input: Record<string, unknown>) => {
    console.log(`\n[Orchestrator] → run_portfolio: ${input.reason}`)
    await runPortfolioManagement(chainId)
    return 'Portfolio management complete.'
  }

  const skipCycleHandler = async (input: Record<string, unknown>) => {
    console.log(`\n[Orchestrator] → skip_cycle: ${input.reason}`)
    return `Cycle skipped: ${input.reason}`
  }

  const router = createRouter({}, {
    run_settlements: runSettlementsHandler,
    run_portfolio:   runPortfolioHandler,
    skip_cycle:      skipCycleHandler,
  })

  const systemPrompt = buildOrchestratorPrompt(state)
  const userMessage  = 'Assess the current state and decide what to do this cycle.'

  const result = await runAgentLoop(
    router,
    systemPrompt,
    [RUN_SETTLEMENTS_TOOL, RUN_PORTFOLIO_TOOL, SKIP_CYCLE_TOOL],
    userMessage,
  )

  console.log('\n╔══════════════════════════════════════╗')
  console.log('║     Orchestrator — Cycle Complete    ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(result)
}
