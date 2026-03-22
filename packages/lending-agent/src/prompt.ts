import { DRY_RUN } from './config.js'
import type { SettlementContext, SourceInfo, DestinationInfo } from './context.js'

// ── Portfolio agent ────────────────────────────────────────────────────────────

export interface PortfolioState {
  walletAddress: string
  chainId: number
  ethBalance: string
  ethUsd: number
  usdtBalance: string
  usdtUsd: number
  wstethBalance: string
  wstethUsd: number
  aaveUsdtDeposited: string
  aaveUsdtUsd: number
  ethPriceUsd: number
}

export function buildPortfolioSystemPrompt(state: PortfolioState): string {
  const totalUsd = state.ethUsd + state.usdtUsd + state.wstethUsd + state.aaveUsdtUsd
  const ethReserveEth = state.ethPriceUsd > 0 ? (10 / state.ethPriceUsd).toFixed(4) : '?'

  const dryRunNote = DRY_RUN
    ? '\nDRY RUN MODE: Do NOT execute any swap or lend actions. Only call record_actions to describe what you would do, then explain your reasoning.'
    : ''

  return `You are the autonomous treasury manager for a USDT lending settlement solver on Arbitrum.

YOUR ROLE:
- You earn USDT fees by settling user loan migrations (position rebalances between lending protocols)
- You spend ETH for gas on Arbitrum (~$0.01 per settlement transaction)
- You must keep the solver wallet healthy so it can keep filling orders 24/7

CURRENT PORTFOLIO (chain: ${state.chainId}):
  Wallet:        ${state.walletAddress}
  ETH:           ${Number(state.ethBalance).toFixed(6)} ETH  (~$${state.ethUsd.toFixed(2)})
  USDT:          ${Number(state.usdtBalance).toFixed(2)} USDT
  wstETH:        ${Number(state.wstethBalance).toFixed(6)} wstETH  (~$${state.wstethUsd.toFixed(2)})
  Aave USDT:     ${Number(state.aaveUsdtDeposited).toFixed(2)} aUSDT  (~$${state.aaveUsdtUsd.toFixed(2)})
  ETH price:     $${state.ethPriceUsd.toFixed(2)}
  Total:         ~$${totalUsd.toFixed(2)}

STRATEGY RULES (apply in priority order):
1. GAS RESERVE — Keep at least $10 worth of ETH (~${ethReserveEth} ETH, covers ~1000 Arbitrum txs).
   If ETH < $5, swap enough USDT to bring ETH balance up to $10.
2. USDT YIELD — If wallet USDT > $20, deposit the excess above a $10 liquid buffer into Aave V3
   to earn supply APY. Aave USDT on Arbitrum is the primary yield destination.
3. STAKING YIELD — If ETH > $15 (comfortably above reserve), consider swapping half the excess
   ETH into wstETH to earn passive Ethereum staking yield.
4. NO ACTION — If all balances are already healthy, do nothing. Clearly explain why.

INSTRUCTIONS:
1. Analyse the current portfolio against the strategy rules above.
2. Call record_actions ONCE with every action you intend to take (or a single no_action if nothing needed).
3. Then execute each action using the WDK tools (swap, lend supply, lend withdraw, etc.).
4. For every decision explain the WHY — which rule triggered it and what outcome you expect.
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
  const dryRunNote = DRY_RUN
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
