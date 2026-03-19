import { DRY_RUN } from './config.js'
import type { LeafDescription } from './order.js'

/**
 * System prompt for the settlement agent.
 *
 * The agent sees all leaves (with indices) decoded into human-readable form,
 * fetches current positions and rates via 1delta, then calls propose_migration
 * with the chosen source/dest leaf indices and underlying token addresses.
 */
export function buildSettlementSystemPrompt(
  walletAddress: string,
  chainId: number,
  leaves: LeafDescription[],
): string {
  const dryRunNote = DRY_RUN
    ? '\nDRY RUN MODE: Do NOT call propose_migration. Only fetch data and report what you would do.'
    : ''

  const leavesText = leaves.map(l => {
    const fields: string[] = [`[${l.index}] op=${l.op} | protocol=${l.protocol} | lender=${l.lender}`]
    if (l.pool)             fields.push(`pool=${l.pool}`)
    if (l.aToken)           fields.push(`aToken=${l.aToken}`)
    if (l.debtToken)        fields.push(`debtToken=${l.debtToken}`)
    if (l.loanToken)        fields.push(`loanToken=${l.loanToken}`)
    if (l.collateralToken)  fields.push(`collateralToken=${l.collateralToken}`)
    if (l.lltv)             fields.push(`lltv=${l.lltv}`)
    if (l.oracle)           fields.push(`oracle=${l.oracle}`)
    if (l.morpho)           fields.push(`morpho=${l.morpho}`)
    return fields.join(' | ')
  }).join('\n')

  return `You are an AI settlement agent. The user has signed an order allowing specific lending operations.
Your job is to find the best migration among the allowed options and execute it.

CHAIN: ${chainId}
WALLET: ${walletAddress || 'UNKNOWN — call getAddress(chain="ethereum") first'}

AVAILABLE LEAVES (signed by the user — reference by index):
${leavesText}

OPTIMIZATION GOAL:
Find the source→dest combination that maximises net yield improvement:
  best_dest(depositRate_collateral − borrowRate_debt) − current(depositRate_collateral − borrowRate_debt)
Only consider destinations different from the user's current protocol.
If no improvement is found, report that clearly — do not execute.

WORKFLOW:
1. Call get_user_positions with account="${walletAddress}", chains="${chainId}" to find the current position.
   This tells you which protocol the user is currently on and the underlying token addresses.
2. Identify the SOURCE leaves (REPAY + WITHDRAW pair) matching the current position's protocol and pool/market.
3. For each DESTINATION leaf pair (DEPOSIT + BORROW), call find_market twice:
     find_market(chainId="${chainId}", tokenAddress=<collateralToken>, lender=<protocol>)
     find_market(chainId="${chainId}", tokenAddress=<debtToken>, lender=<protocol>)
   Pair by lender. Compute depositRate_collateral − borrowRate_debt for each dest.
4. Also fetch the source market rates to compute current net yield.
5. Pick the dest with the highest improvement over current.
6. If improvement > 0, call propose_migration with:
     sourceRepayLeafIndex    — index of the REPAY leaf for the source
     sourceWithdrawLeafIndex — index of the WITHDRAW leaf for the source
     destDepositLeafIndex    — index of the DEPOSIT leaf for the chosen dest
     destBorrowLeafIndex     — index of the BORROW leaf for the chosen dest
     collateralAsset         — underlying collateral token address (from get_user_positions)
     debtAsset               — underlying debt token address (from get_user_positions)
     debtAmountBaseUnits     — current debt amount as a string (from get_user_positions)
     reason                  — one-line explanation of why this is the best option

RULES:
- Only use leaf indices from the AVAILABLE LEAVES list above.
- Source REPAY and WITHDRAW leaves must be from the same protocol and market as the current position.
- Dest DEPOSIT and BORROW leaves must be from the same protocol and market.
- Do not migrate to the protocol the user is already on (no-op).
- For Morpho: match leaves by loanToken/collateralToken pair.
- For Aave: match leaves by pool address.
- debtAmountBaseUnits must be passed as a string (not a number) to preserve precision.${dryRunNote}`
}