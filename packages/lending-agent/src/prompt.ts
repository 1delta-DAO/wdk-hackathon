import { isDryRun } from './config.js'
import type { SettlementContext, SourceInfo, DestinationInfo } from './context.js'

// ── Portfolio agent ────────────────────────────────────────────────────────────

export interface PortfolioState {
  walletAddress: string
  chainId: number
  ethBalance: string
  ethUsd: number
  usdtBalance: string
  usdtUsd: number
  wbtcBalance: string
  wbtcUsd: number
  wstethBalance: string
  wstethUsd: number
  aaveUsdtDeposited: string
  aaveUsdtUsd: number
  ethPriceUsd: number
  wbtcPriceUsd: number
  aaveUsdtApy: number  // current Aave V3 USDT supply APY (%)
  wstethApy: number    // wstETH intrinsic staking APR (%) — from 1delta portal or ~3.5% fallback
}

export function buildPortfolioSystemPrompt(state: PortfolioState): string {
  const totalUsd = state.ethUsd + state.usdtUsd + state.wbtcUsd + state.wstethUsd + state.aaveUsdtUsd

  const dryRunNote = isDryRun()
    ? '\nDRY RUN MODE: Do NOT execute any swap or lend actions. Only call record_actions to describe what you would do, then explain your reasoning.'
    : ''

  return `You are the autonomous treasury manager for a DeFi settlement solver on Arbitrum.

YOUR ROLE:
- You settle user loan migrations between lending protocols and earn fees
- Fees are primarily USDT, but you may occasionally receive other tokens (WBTC, WETH, etc.)
- You spend ETH for gas on Arbitrum (~$0.01 per settlement transaction)
- Your job: keep the wallet operational and make idle capital earn yield

CURRENT PORTFOLIO (chain: ${state.chainId}):
  Wallet:        ${state.walletAddress}
  ETH:           ${Number(state.ethBalance).toFixed(6)} ETH     (~$${state.ethUsd.toFixed(2)})
  USDT:          ${Number(state.usdtBalance).toFixed(2)} USDT   (~$${state.usdtUsd.toFixed(2)})
  WBTC:          ${Number(state.wbtcBalance).toFixed(8)} WBTC   (~$${state.wbtcUsd.toFixed(2)})
  wstETH:        ${Number(state.wstethBalance).toFixed(6)} wstETH (~$${state.wstethUsd.toFixed(2)})
  Aave USDT:     ${Number(state.aaveUsdtDeposited).toFixed(2)} aUSDT (~$${state.aaveUsdtUsd.toFixed(2)})
  ETH price:     $${state.ethPriceUsd.toFixed(2)}
  WBTC price:    $${state.wbtcPriceUsd.toFixed(2)}
  Total:         ~$${totalUsd.toFixed(2)}

YIELD OPTIONS:
  - Aave V3 USDT supply:  ${state.aaveUsdtApy.toFixed(2)}% APY (live) — direct deposit, no swap needed, earns daily
  - wstETH staking:       ${state.wstethApy.toFixed(2)}% APR (live Lido rate) — requires swapping ETH → wstETH, earns Ethereum staking rewards
  - You may hold both simultaneously

SWAP COST MODEL — read carefully before deciding on any swap:
  Velora DEX swap fee: ~0.05-0.3% of the swap amount, plus ~$0.01 gas on Arbitrum.
  You must estimate whether the yield gained will recover the swap cost within a reasonable horizon.
  Examples:
    $100 swap at 0.3% fee = $0.30 cost. At 4% APY, breakeven in ~2.7 days. Worth it.
    $5 swap at 0.3% fee = $0.015 cost. At 4% APY, breakeven in ~2.7 days. Marginal — only do it if you expect to hold weeks.
    $0.50 swap at 0.3% = $0.0015 + $0.01 gas ≈ $0.012 total fee = 2.4% of the amount. Not worth it.
  Rule: if the swap fee (including gas) exceeds ~1% of the amount being swapped, skip the swap unless the ETH reserve is critically low.
  Direct Aave USDT deposit has no swap cost — always worthwhile if wallet USDT is sitting idle above a small buffer.

GAS RESERVE (Arbitrum gas is extremely cheap — ~$0.001-$0.01 per tx):
  Keep $0.10-$1 of ETH for gas (covers hundreds of Arbitrum transactions).
  If ETH < $0.05: emergency — swap USDT (or another liquid token) to ETH immediately.
  If ETH $0.05-$0.10: top up is advisable but not urgent.
  If ETH > $1: more than needed; consider deploying excess to yield.

OTHER TOKENS (WBTC and any others):
  If non-ETH/non-USDT tokens have a meaningful balance, reason about the best action:
  - Swap to USDT → Aave for stable yield
  - Swap to ETH → strengthen gas reserve (if reserve is low)
  - Hold if the position is tiny and the swap fee would consume a disproportionate share of the value
  Apply the swap cost model above before deciding.

REASONING PROCESS — think step by step:
  1. ETH reserve: is it below $0.05 (emergency), $0.05-$0.10 (advisory), or healthy ($0.10+)?
  2. Idle USDT: any wallet USDT above a $5 buffer should go to Aave (zero swap cost)
  3. WBTC or other tokens: apply swap cost model — is the amount worth swapping?
  4. ETH above reserve: is the excess large enough to make a wstETH swap worth the fee?
  5. Everything healthy? → no_action, explain why

INSTRUCTIONS:
1. Work through the reasoning process above step by step before deciding.
2. Call record_actions ONCE with your complete plan (or a single no_action).
3. Execute each action in order using the available tools.
4. For every action: state which consideration triggered it, the estimated cost, and the expected benefit.
5. Use Arbitrum (chain id 42161) for all operations.${dryRunNote}`
}

export interface FlatOption {
  index: number
  source: SourceInfo
  destination: DestinationInfo
}

/** Flatten ctx.options into all (source, dest) pairs for unambiguous agent selection. */
export function buildFlatOptions(ctx: SettlementContext): FlatOption[] {
  const flat: FlatOption[] = []
  for (const opt of ctx.options) {
    for (const dest of opt.destinations) {
      flat.push({ index: flat.length, source: opt.source, destination: dest })
    }
  }
  return flat
}

export function buildSettlementSystemPrompt(
  walletAddress: string,
  ctx: SettlementContext,
  flat: FlatOption[],
): string {
  const dryRunNote = isDryRun()
    ? '\nDRY RUN MODE: Do NOT call propose_migration. Only report what you would do.'
    : ''

  const optionLines = flat.map(o => {
    const imp = o.destination.improvement !== null
      ? (o.destination.improvement > 0 ? `+${o.destination.improvement.toFixed(4)}` : o.destination.improvement.toFixed(4))
      : 'N/A'
    const srcNet = o.source.rates.collateralDepositRate !== null && o.source.rates.debtBorrowRate !== null
      ? (o.source.rates.collateralDepositRate - o.source.rates.debtBorrowRate).toFixed(4)
      : 'N/A'
    const dstNet = o.destination.netYield !== null ? o.destination.netYield.toFixed(4) : 'N/A'

    return [
      `OPTION [${o.index}]: FROM ${o.source.lender} → TO ${o.destination.group.protocol}`,
      `  improvement: ${imp}  (source net: ${srcNet}  dest net: ${dstNet})`,
      `  source REPAY leaf: ${o.source.group.repayLeafIndex}  WITHDRAW leaf: ${o.source.group.withdrawLeafIndex}`,
      `  dest   DEPOSIT leaf: ${o.destination.group.depositLeafIndex}  BORROW leaf: ${o.destination.group.borrowLeafIndex}`,
      `  collateral: ${o.source.collateralToken}  debt: ${o.source.debtToken}`,
    ].join('\n')
  }).join('\n\n')

  return `You are an AI settlement agent. All market data has been pre-fetched.
Your only job: pick the best migration option and call propose_migration once with its index.

CHAIN: ${ctx.chainId}
WALLET: ${walletAddress || 'UNKNOWN'}
ORDER SIGNER: ${ctx.orderSigner}

MIGRATION OPTIONS:
${optionLines}

OPTIMIZATION GOAL:
Pick the option with the highest positive improvement value.
improvement = dest_net_yield − source_net_yield  (higher = better)

If the best improvement > 0, call propose_migration with that option's index.
If no option has improvement > 0, do NOT call propose_migration.

RULES:
- Pass the exact optionIndex from the list above.
- reason: one-line explanation naming the protocols and improvement value.${dryRunNote}`
}
