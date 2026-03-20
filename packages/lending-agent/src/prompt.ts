import { DRY_RUN } from './config.js'
import type { SettlementContext } from './context.js'

/**
 * System prompt for the settlement agent.
 *
 * Receives pre-computed SettlementContext (source + destination rates already
 * fetched by TypeScript). The agent only needs to decide which option is best
 * and call propose_migration with the chosen leaf indices.
 */
export function buildSettlementSystemPrompt(
  walletAddress: string,
  ctx: SettlementContext,
): string {
  const dryRunNote = DRY_RUN
    ? '\nDRY RUN MODE: Do NOT call propose_migration. Only report what you would do.'
    : ''

  const { source, destinations } = ctx

  const sourceBlock = [
    `Protocol: ${source.lender}`,
    `Collateral: ${source.collateralToken}`,
    `Debt:       ${source.debtToken}`,
    `Debt amount (base units): ${source.debtAmountBaseUnits}`,
    `Collateral deposit rate: ${source.rates.collateralDepositRate?.toFixed(4) ?? 'N/A'}`,
    `Debt borrow rate:        ${source.rates.debtBorrowRate?.toFixed(4) ?? 'N/A'}`,
    `Net yield (deposit − borrow): ${
      source.rates.collateralDepositRate !== null && source.rates.debtBorrowRate !== null
        ? (source.rates.collateralDepositRate - source.rates.debtBorrowRate).toFixed(4)
        : 'N/A'
    }`,
    `REPAY leaf index:    ${source.group.repayLeafIndex}`,
    `WITHDRAW leaf index: ${source.group.withdrawLeafIndex}`,
  ].join('\n  ')

  const destBlocks = destinations.length === 0
    ? '  (none available)'
    : destinations.map((d, i) => {
        const net = d.rates.collateralDepositRate !== null && d.rates.debtBorrowRate !== null
          ? (d.rates.collateralDepositRate - d.rates.debtBorrowRate).toFixed(4)
          : 'N/A'
        return [
          `[${i}] Protocol: ${d.group.protocol} (${d.group.marketKey})`,
          `  Collateral deposit rate: ${d.rates.collateralDepositRate?.toFixed(4) ?? 'N/A'}`,
          `  Debt borrow rate:        ${d.rates.debtBorrowRate?.toFixed(4) ?? 'N/A'}`,
          `  Net yield (deposit − borrow): ${net}`,
          `  DEPOSIT leaf index: ${d.group.depositLeafIndex}`,
          `  BORROW leaf index:  ${d.group.borrowLeafIndex}`,
        ].join('\n')
      }).join('\n\n')

  return `You are an AI settlement agent. All market data has been pre-fetched.
Your only job: pick the best destination and call propose_migration once.

CHAIN: ${ctx.chainId}
WALLET: ${walletAddress || 'UNKNOWN'}
ORDER SIGNER: ${ctx.orderSigner}

CURRENT SOURCE POSITION:
  ${sourceBlock}

DESTINATION OPTIONS:
${destBlocks}

OPTIMIZATION GOAL:
Pick the destination with the highest net yield improvement over the current source:
  improvement = dest(depositRate_collateral − borrowRate_debt) − source(depositRate_collateral − borrowRate_debt)

If improvement > 0, call propose_migration with the destination's leaf indices and the source token addresses.
If no destination improves on the source, report that clearly — do NOT call propose_migration.

RULES:
- Use ONLY the leaf indices shown above.
- collateralAsset = ${source.collateralToken}
- debtAsset       = ${source.debtToken}
- reason: one-line explanation comparing net yields${dryRunNote}`
}
