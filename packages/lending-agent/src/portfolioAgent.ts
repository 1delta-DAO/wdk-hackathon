/**
 * Autonomous portfolio management agent.
 *
 * After each settlement batch the solver wallet holds earned USDT fees and
 * spends ETH on gas. This agent runs the LLM against the current wallet state
 * and decides — autonomously — when to swap USDT→ETH to top up the gas
 * reserve, when to deposit idle USDT into Aave for yield, and whether to
 * hold wstETH for passive staking income.
 *
 * Execution uses the WDK packages directly (no MCP server needed).
 */

import { createPublicClient, http, parseAbi, formatUnits, parseUnits } from 'viem'
import type { Address } from 'viem'
import { createRouter } from './mcp.js'
import type { GenericTool } from './providers/index.js'
import { runAgentLoop } from './agent.js'
import { buildPortfolioSystemPrompt } from './prompt.js'
import type { PortfolioState } from './prompt.js'
import { isDryRun, RPC_URL_BY_CHAIN, CONTRACTS_BY_CHAIN, ONEDELTA_PORTAL_URL, getOneDeltaApiKey } from './config.js'
import { getWdkAddress, swapTokens, aaveSupply, aaveWithdraw } from './wdk.js'

// ── Token addresses (Arbitrum One) ────────────────────────────────────────────

const USDT_ARB   = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address
const WBTC_ARB   = '0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f' as Address
const WSTETH_ARB = '0x5979D7b546E38E414F7E9822514be443A4800529' as Address
const WETH_ARB   = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address
const AUSDT_ARB  = '0x6ab707Aca953eDAeFBc4fD23bA73294241490620' as Address

// Aave V3 Pool on Arbitrum — used to read current supply APY for USDT
const AAVE_POOL_ARB = '0x794a61358D6845594F94dc1DB02A252b5b4814aD' as Address

// Approximate wstETH staking APY used when the portal API returns no data.
// wstETH native yield is earned on Ethereum L1; there is no on-chain oracle for it on Arbitrum.
const WSTETH_APY_FALLBACK = 3.5

const ERC20_BALANCE_ABI = parseAbi([
  'function balanceOf(address account) external view returns (uint256)',
])
const AAVE_ORACLE_ABI = parseAbi([
  'function getAssetPrice(address asset) external view returns (uint256)',
])
// getReserveData returns 15 values; currentLiquidityRate is index 2, in RAY (1e27 = 100% APR)
const AAVE_POOL_RESERVE_ABI = parseAbi([
  'function getReserveData(address) view returns (uint256, uint128, uint128, uint128, uint128, uint128, uint40, uint16, address, address, address, address, uint128, uint128, uint128)',
])

// ── Yield rate fetching ───────────────────────────────────────────────────────

/**
 * Fetches live yield rates:
 *   - Aave USDT supply APY: currentLiquidityRate from the Aave V3 Pool on-chain (RAY → %).
 *   - wstETH intrinsic staking APR: from the 1delta portal intrinsic yield endpoint.
 *     This reflects the actual Lido staking reward rate (not the Aave lending rate for wstETH).
 *     Falls back to WSTETH_APY_FALLBACK if the endpoint is unavailable.
 * Returns rates as percentages (e.g. 4.2 = 4.2%).
 */
async function fetchYieldRates(
  client: ReturnType<typeof createPublicClient>,
): Promise<{ aaveUsdtApy: number; wstethApy: number }> {
  const [aaveResult, wstethResult] = await Promise.allSettled([
    client.readContract({
      address: AAVE_POOL_ARB,
      abi: AAVE_POOL_RESERVE_ABI,
      functionName: 'getReserveData',
      args: [USDT_ARB],
    }),
    fetchWstethApy(),
  ])

  // currentLiquidityRate is index 2 in the 15-value tuple; divide by 1e27 for APR → × 100 for %
  const aaveUsdtApy = aaveResult.status === 'fulfilled'
    ? Number((aaveResult.value as readonly bigint[])[2]) / 1e27 * 100
    : 0

  const wstethApy = wstethResult.status === 'fulfilled' && wstethResult.value > 0
    ? wstethResult.value
    : WSTETH_APY_FALLBACK

  return { aaveUsdtApy, wstethApy }
}

/**
 * Fetches the wstETH intrinsic staking APR from the 1delta portal.
 * Endpoint: /v1/data/lending/yields/intrinsic/latest?assets=WSTETH
 * Returns: APR as a percentage (e.g. 2.64 means 2.64% APR).
 * The intrinsic yield is the actual Lido staking reward rate — not the Aave lending rate.
 */
async function fetchWstethApy(): Promise<number> {
  const url = `${ONEDELTA_PORTAL_URL}/v1/data/lending/yields/intrinsic/latest?assets=WSTETH`
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const apiKey = getOneDeltaApiKey()
  if (apiKey) headers['x-api-key'] = apiKey

  const res = await fetch(url, { headers })
  if (!res.ok) return 0

  const body = await res.json() as { data?: { items?: { WSTETH?: number } } }
  return body?.data?.items?.WSTETH ?? 0
}

// ── State fetching ────────────────────────────────────────────────────────────

async function fetchPortfolioState(chainId: number): Promise<PortfolioState> {
  const seed    = process.env.WDK_SEED ?? ''
  const rpcUrl  = RPC_URL_BY_CHAIN[chainId]
  const contracts = CONTRACTS_BY_CHAIN[chainId]

  const walletAddress = seed ? await getWdkAddress(seed, rpcUrl) : '' as Address
  const client = createPublicClient({ transport: http(rpcUrl) })

  const [[ethBal, usdtBal, wbtcBal, wstethBal, ausdtBal, ethPriceRaw, wbtcPriceRaw], { aaveUsdtApy, wstethApy }] = await Promise.all([
    Promise.all([
      client.getBalance({ address: walletAddress as Address }).catch(() => 0n),
      client.readContract({ address: USDT_ARB,   abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [walletAddress as Address] }).catch(() => 0n),
      client.readContract({ address: WBTC_ARB,   abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [walletAddress as Address] }).catch(() => 0n),
      client.readContract({ address: WSTETH_ARB, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [walletAddress as Address] }).catch(() => 0n),
      client.readContract({ address: AUSDT_ARB,  abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [walletAddress as Address] }).catch(() => 0n),
      client.readContract({ address: contracts.aaveOracle as Address, abi: AAVE_ORACLE_ABI, functionName: 'getAssetPrice', args: [WETH_ARB] }).catch(() => 0n),
      client.readContract({ address: contracts.aaveOracle as Address, abi: AAVE_ORACLE_ABI, functionName: 'getAssetPrice', args: [WBTC_ARB] }).catch(() => 0n),
    ]),
    fetchYieldRates(client),
  ])

  const ethPriceUsd  = Number(ethPriceRaw)  / 1e8
  const wbtcPriceUsd = Number(wbtcPriceRaw) / 1e8
  const ethBalFloat  = Number(formatUnits(ethBal,    18))
  const wbtcFloat    = Number(formatUnits(wbtcBal,    8))
  const wstethFloat  = Number(formatUnits(wstethBal, 18))

  return {
    walletAddress,
    chainId,
    ethBalance:        formatUnits(ethBal,    18),
    ethUsd:            ethBalFloat * ethPriceUsd,
    usdtBalance:       formatUnits(usdtBal,    6),
    usdtUsd:           Number(formatUnits(usdtBal, 6)),
    wbtcBalance:       formatUnits(wbtcBal,    8),
    wbtcUsd:           wbtcFloat * wbtcPriceUsd,
    wstethBalance:     formatUnits(wstethBal, 18),
    wstethUsd:         wstethFloat * ethPriceUsd,
    aaveUsdtDeposited: formatUnits(ausdtBal,   6),
    aaveUsdtUsd:       Number(formatUnits(ausdtBal, 6)),
    ethPriceUsd,
    wbtcPriceUsd,
    aaveUsdtApy,
    wstethApy,
  }
}

// ── Tools ─────────────────────────────────────────────────────────────────────

interface PlannedAction {
  action: 'swap' | 'aave_supply' | 'aave_withdraw' | 'no_action'
  reason: string
  details?: string
}

const RECORD_ACTIONS_TOOL: GenericTool = {
  name: 'record_actions',
  description:
    'Record all planned portfolio actions before executing them. Call this exactly once with the complete action plan.',
  inputSchema: {
    type: 'object',
    properties: {
      actions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            action:  { type: 'string', enum: ['swap', 'aave_supply', 'aave_withdraw', 'no_action'] },
            reason:  { type: 'string' },
            details: { type: 'string' },
          },
          required: ['action', 'reason'],
        },
      },
    },
    required: ['actions'],
  },
}

const SWAP_TOOL: GenericTool = {
  name: 'swap',
  description: 'Swap tokens on Arbitrum via Velora DEX. Use to swap USDT → WETH to top up the gas reserve.',
  inputSchema: {
    type: 'object',
    properties: {
      tokenIn:      { type: 'string', description: 'Address of the token to sell' },
      tokenOut:     { type: 'string', description: 'Address of the token to buy' },
      amountInUsdt: { type: 'number', description: 'Amount of tokenIn to sell (in human-readable units, e.g. 20 for 20 USDT)' },
    },
    required: ['tokenIn', 'tokenOut', 'amountInUsdt'],
  },
}

const AAVE_SUPPLY_TOOL: GenericTool = {
  name: 'aave_supply',
  description: 'Supply USDT to Aave V3 on Arbitrum to earn yield.',
  inputSchema: {
    type: 'object',
    properties: {
      amountUsdt: { type: 'number', description: 'Amount of USDT to supply (human-readable, e.g. 50 for 50 USDT)' },
    },
    required: ['amountUsdt'],
  },
}

const AAVE_WITHDRAW_TOOL: GenericTool = {
  name: 'aave_withdraw',
  description: 'Withdraw USDT from Aave V3 on Arbitrum.',
  inputSchema: {
    type: 'object',
    properties: {
      amountUsdt: { type: 'number', description: 'Amount of USDT to withdraw (human-readable)' },
    },
    required: ['amountUsdt'],
  },
}

// ── Agent loop ────────────────────────────────────────────────────────────────

export async function runPortfolioManagement(chainId: number): Promise<void> {
  console.log('\n=== Portfolio Management ===')

  const state = await fetchPortfolioState(chainId)
  const seed    = process.env.WDK_SEED ?? ''
  const rpcUrl  = RPC_URL_BY_CHAIN[chainId]

  console.log(`  Wallet:       ${state.walletAddress}`)
  console.log(`  ETH:          ${Number(state.ethBalance).toFixed(6)} ETH   (~$${state.ethUsd.toFixed(2)})`)
  console.log(`  USDT:         ${Number(state.usdtBalance).toFixed(2)} USDT`)
  console.log(`  WBTC:         ${Number(state.wbtcBalance).toFixed(8)} WBTC  (~$${state.wbtcUsd.toFixed(2)})`)
  console.log(`  wstETH:       ${Number(state.wstethBalance).toFixed(6)} wstETH (~$${state.wstethUsd.toFixed(2)})`)
  console.log(`  Aave USDT:    ${Number(state.aaveUsdtDeposited).toFixed(2)} aUSDT  (~$${state.aaveUsdtUsd.toFixed(2)})`)
  console.log(`  ETH price:    $${state.ethPriceUsd.toFixed(2)}`)
  console.log(`  WBTC price:   $${state.wbtcPriceUsd.toFixed(2)}`)
  console.log(`  Aave USDT APY: ${state.aaveUsdtApy.toFixed(2)}%`)
  console.log(`  wstETH APR:    ${state.wstethApy.toFixed(2)}%${state.wstethApy === WSTETH_APY_FALLBACK ? ' (fallback estimate)' : ' (live Lido rate)'}`)

  let plannedActions: PlannedAction[] = []

  const recordActionsHandler = async (input: Record<string, unknown>) => {
    plannedActions = (input.actions as PlannedAction[]) ?? []
    console.log('\n→ Portfolio plan:')
    for (const a of plannedActions) {
      console.log(`  [${a.action}] ${a.reason}${a.details ? ' — ' + a.details : ''}`)
    }
    const hasRealActions = plannedActions.some(a => a.action !== 'no_action')
    if (!hasRealActions) {
      return 'Plan recorded: no_action. You are done — do NOT execute any swaps or supply calls.'
    }
    return 'Actions recorded. Execute each action in order using the available tools.'
  }

  const swapHandler = async (input: Record<string, unknown>) => {
    const tokenIn      = String(input.tokenIn)
    const tokenOut     = String(input.tokenOut)
    const amountInUsdt = Number(input.amountInUsdt)
    const amountIn     = parseUnits(String(amountInUsdt), 6) // USDT has 6 decimals

    if (isDryRun()) {
      console.log(`  [DRY RUN] swap(${tokenIn} → ${tokenOut}, ${amountInUsdt} USDT)`)
      return '[DRY RUN] swap not executed.'
    }
    if (!seed) return 'WDK_SEED not set — cannot swap.'

    console.log(`  → Swapping ${amountInUsdt} USDT → WETH…`)
    const hash = await swapTokens(seed, rpcUrl, tokenIn, tokenOut, amountIn)
    console.log(`  ✓ swap tx: ${hash}`)
    return `Swap complete. tx: ${hash}`
  }

  const aaveSupplyHandler = async (input: Record<string, unknown>) => {
    const amountUsdt = Number(input.amountUsdt)
    const amount     = parseUnits(String(amountUsdt), 6)

    if (isDryRun()) {
      console.log(`  [DRY RUN] aave_supply(USDT, ${amountUsdt})`)
      return '[DRY RUN] aave_supply not executed.'
    }
    if (!seed) return 'WDK_SEED not set — cannot supply.'

    console.log(`  → Supplying ${amountUsdt} USDT to Aave…`)
    const hash = await aaveSupply(seed, rpcUrl, USDT_ARB, amount)
    console.log(`  ✓ supply tx: ${hash}`)
    return `Aave supply complete. tx: ${hash}`
  }

  const aaveWithdrawHandler = async (input: Record<string, unknown>) => {
    const amountUsdt = Number(input.amountUsdt)
    const amount     = parseUnits(String(amountUsdt), 6)

    if (isDryRun()) {
      console.log(`  [DRY RUN] aave_withdraw(USDT, ${amountUsdt})`)
      return '[DRY RUN] aave_withdraw not executed.'
    }
    if (!seed) return 'WDK_SEED not set — cannot withdraw.'

    console.log(`  → Withdrawing ${amountUsdt} USDT from Aave…`)
    const hash = await aaveWithdraw(seed, rpcUrl, USDT_ARB, amount)
    console.log(`  ✓ withdraw tx: ${hash}`)
    return `Aave withdraw complete. tx: ${hash}`
  }

  const router = createRouter({}, {
    record_actions: recordActionsHandler,
    swap:           swapHandler,
    aave_supply:    aaveSupplyHandler,
    aave_withdraw:  aaveWithdrawHandler,
  })

  const allTools: GenericTool[] = [RECORD_ACTIONS_TOOL, SWAP_TOOL, AAVE_SUPPLY_TOOL, AAVE_WITHDRAW_TOOL]

  const systemPrompt = buildPortfolioSystemPrompt(state)
  const userMessage =
    'Review the current portfolio state and manage the treasury. ' +
    'Start by calling record_actions with your complete plan, then execute each action.'

  const result = await runAgentLoop(router, systemPrompt, allTools, userMessage)

  const noActionOnly = plannedActions.length === 1 && plannedActions[0].action === 'no_action'
  if (plannedActions.length === 0) {
    console.log('\n  Agent did not call record_actions — no structured plan captured.')
  } else if (noActionOnly) {
    console.log(`\n  No action taken: ${plannedActions[0].reason}`)
  }

  console.log('\n=== Portfolio Agent Result ===')
  console.log(result || '(no further commentary from agent)')
}
