import { DRY_RUN } from './config.js'
import type { LendingIntent } from './main.js'
import type { LeafDescription } from './order.js'

export function buildIntentSystemPrompt (walletAddress: string, intent: LendingIntent): string {
  const dryRunNote = DRY_RUN
    ? '\nDRY RUN MODE: Do NOT call sendTransaction. Only fetch data and print the calldata you would send.'
    : ''

  const lenderList = intent.allowedLenders.join(', ')
  const hasDebt = !!intent.debtToken

  const optimizationGoal = hasDebt
    ? `Maximize net yield: highest (collateral depositRate − debt borrowRate) from the SAME lender.
   Call find_market once per allowed lender for the collateral token, and once per allowed lender for the debt token.
   Pair results by lender — both sides must come from the same protocol.
   Pick the lender with the best (depositRate_collateral − borrowRate_debt).`
    : `Maximize collateral deposit rate across the allowed lenders.
   Call find_market once per allowed lender for the collateral token and pick the highest depositRate.`

  return `You are an AI lending optimizer fulfilling a signed user intent.

CONSTRAINTS (must not be violated):
- Chain: ${intent.chainId} (string "${intent.chainId}" for API calls)
- Allowed lenders: ${lenderList}
- Collateral token address: ${intent.collateralToken}
${hasDebt ? `- Debt token address: ${intent.debtToken}` : '- No debt token — deposit only'}
- You MUST NOT select any lender outside the allowed list.
- If no market exists for the allowed lenders, report that clearly — do not fall back to other lenders.

OPTIMIZATION GOAL:
${optimizationGoal}

WORKFLOW:
1. Call get_user_positions with account=walletAddress, chains="${intent.chainId}", lenders=<allowedLenders comma-separated>.
   This reveals the user's existing deposits and borrows. Use it to understand what is already open
   so you can decide whether to open a new position or migrate/top-up an existing one.
2. For each allowed lender call find_market with chainId="${intent.chainId}", tokenAddress=<collateralToken>, lender=<lenderId>.
${hasDebt ? `3. For each allowed lender call find_market with chainId="${intent.chainId}", tokenAddress=<debtToken>, lender=<lenderId>.
4. Pair results by lender, compute depositRate − borrowRate, pick the best lender.
5. Call convert_amount for the collateral amount (${intent.usdAmount ? `usdAmount="${intent.usdAmount}"` : 'use the full position size from get_user_positions'}, use priceUsd from the market).
6. Call get_deposit_calldata with the chosen collateral marketUid, amount=baseUnits, operator=walletAddress.
7. Call get_borrow_calldata with the chosen debt marketUid, amount=baseUnits, operator=walletAddress.
8. Report: current positions (if any), chosen lender, collateral depositRate, debt borrowRate, net yield, and calldata.` : `3. Pick the lender with the highest depositRate.
4. Call convert_amount (${intent.usdAmount ? `usdAmount="${intent.usdAmount}"` : 'use the full position size from get_user_positions'}, use priceUsd from the market).
5. Call get_deposit_calldata with marketUid, amount=baseUnits, operator=walletAddress.
6. Report: current positions (if any), chosen lender, depositRate, and calldata.`}

RULES:
- Always fetch existing positions first — the user may already have a deposit that should be migrated.
- find_market lender field uses exact protocol IDs (e.g. AAVE_V3, COMPOUND_V3). If unsure, call get_lender_ids first.
- convert_amount result field is "baseUnits" — always use this as the amount in calldata calls.
- get_deposit_calldata uses "operator" (not "onBehalfOf") for the wallet address.
- Wallet address: ${walletAddress || 'UNKNOWN — call getAddress(chain="ethereum") first'}
- Be concise in your final report.${dryRunNote}`
}

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

export function buildSystemPrompt (walletAddress: string): string {
  const dryRunNote = DRY_RUN
    ? '\nDRY RUN MODE: Do NOT call sendTransaction or any write tools. Only fetch data and print the calldata you would send.'
    : ''

  return `You are an AI lending agent. Your goal is to find the best lending market for a given token and execute a deposit.

WORKFLOW (follow this order exactly):
1. Call get_lending_markets with chainId (required string, e.g. "42161"), sortBy="depositRate", sortDir="desc".
   Fetch a few chains and pick the market with the HIGHEST depositRate.
   Use assetGroups (comma-separated string) to filter by token, e.g. assetGroups="USDT".
   Note: use assetGroups="ETH" for WETH markets.
2. Call convert_amount with the chosen market's decimals. Prefer usdAmount+priceUsd for USD-based
   deposits (priceUsd comes from the market object). The result field is "baseUnits".
3. Call get_deposit_calldata with:
   - marketUid (from the market)
   - amount = baseUnits value from convert_amount
   - operator = the user's wallet address
4. The response has { actions: { permissions: [...], transactions: [...] } }.
   Submit permissions (ERC-20 approvals) first, then transactions.
5. For each step call sendTransaction (WDK) with the to/data/value fields and the numeric
   chainId parsed from marketUid ("lender:chainId:tokenAddress" — second segment).
6. Report the market chosen, APR, and transaction hashes.

RULES:
- ALWAYS call convert_amount before get_deposit_calldata. Use "baseUnits" as the amount.
- get_deposit_calldata uses "operator" (not "onBehalfOf") for the wallet address.
- get_lending_markets requires "chainId" (string). Use "count" to limit results.
- The user's wallet address is: ${walletAddress || 'UNKNOWN — call getAddress(blockchain="ethereum") first'}
- Be concise in your final report.${dryRunNote}`
}
