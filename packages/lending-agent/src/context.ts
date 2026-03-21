/**
 * Pre-processes order leaves into a SettlementContext before the agent runs.
 *
 * TypeScript handles all data plumbing:
 *   1. Group leaves by (protocol, market)
 *   2. Fetch user positions (one call, no filters)
 *   3. Identify source group (has REPAY+WITHDRAW and debt > 0)
 *   4. Resolve underlying token addresses
 *   5. Fetch current rates for source + all destination groups
 *
 * The agent only sees pre-computed options and decides which (if any) to execute.
 */

import type { Address } from 'viem'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { callToolRaw } from './mcp.js'
import type { LeafDescription, StoredOrder } from './order.js'
import { cometToLender } from './config.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LeafGroup {
  protocol: string
  marketKey: string
  repayLeafIndex?: number
  withdrawLeafIndex?: number
  depositLeafIndex?: number
  borrowLeafIndex?: number
  // Morpho: underlying tokens are explicit in the leaf
  loanToken?: string
  collateralToken?: string
  lltv?: string
  // CompoundV3: the comet (market) address
  comet?: string
  // Aave: the pool address + token wrappers (from WITHDRAW / REPAY leaves)
  pool?: string
  aToken?: string        // aToken from WITHDRAW leaf → call UNDERLYING_ASSET_ADDRESS()
  aaveDebtToken?: string // variableDebtToken from REPAY leaf → call UNDERLYING_ASSET_ADDRESS()
}

export interface MarketRates {
  collateralDepositRate: number | null
  debtBorrowRate: number | null
  collateralLiquidityUsd: number | null
  debtLiquidityUsd: number | null
}

export interface SourceInfo {
  group: LeafGroup
  lender: string          // exact API lender name (e.g. "COMPOUND_V3_USDC")
  collateralToken: Address
  debtToken: Address
  debtAmountBaseUnits: string
  rates: MarketRates
}

export interface DestinationInfo {
  group: LeafGroup
  rates: MarketRates
  netYield: number | null
  improvement: number | null
}

export interface MigrationOption {
  source: SourceInfo
  destinations: DestinationInfo[]
}

export interface SettlementContext {
  chainId: number
  orderSigner: string
  options: MigrationOption[]
}

type PositionItem = Record<string, unknown>

// ── Leaf grouping ─────────────────────────────────────────────────────────────

export function groupLeaves(leaves: LeafDescription[]): LeafGroup[] {
  const groups = new Map<string, LeafGroup>()

  for (const leaf of leaves) {
    let marketKey: string
    const extra: Partial<LeafGroup> = {}

    if (leaf.comet) {
      marketKey = `${leaf.protocol}:${leaf.comet}`
      extra.comet = leaf.comet
    } else if (leaf.loanToken && leaf.collateralToken) {
      marketKey = `${leaf.protocol}:${leaf.loanToken}:${leaf.collateralToken}`
      extra.loanToken      = leaf.loanToken
      extra.collateralToken = leaf.collateralToken
      extra.lltv           = leaf.lltv
    } else if (leaf.pool) {
      marketKey = `${leaf.protocol}:${leaf.pool}`
      extra.pool = leaf.pool
    } else {
      marketKey = `${leaf.protocol}:unknown`
    }

    if (!groups.has(marketKey)) {
      groups.set(marketKey, { protocol: leaf.protocol, marketKey, ...extra })
    }

    const g = groups.get(marketKey)!
    if (leaf.op === 'REPAY')    { g.repayLeafIndex    = leaf.index; if (leaf.debtToken) g.aaveDebtToken = leaf.debtToken }
    if (leaf.op === 'WITHDRAW') { g.withdrawLeafIndex = leaf.index; if (leaf.aToken)    g.aToken        = leaf.aToken    }
    if (leaf.op === 'DEPOSIT')  g.depositLeafIndex  = leaf.index
    if (leaf.op === 'BORROW')   g.borrowLeafIndex   = leaf.index
  }

  return Array.from(groups.values())
}

// ── Position fetching ─────────────────────────────────────────────────────────

async function fetchAllPositions(
  signer: string,
  chainId: number,
  oneDeltaClient: Client,
): Promise<PositionItem[]> {
  const raw = await callToolRaw(oneDeltaClient, 'get_user_positions', {
    account: signer,
    chains: String(chainId),
  })
  const parsed = JSON.parse(raw) as { data?: { items?: PositionItem[] } }
  return parsed?.data?.items ?? []
}

function matchPositionForGroup(group: LeafGroup, positions: PositionItem[]): PositionItem | null {
  const protocol = group.protocol.toUpperCase()
  for (const item of positions) {
    const lender = String(item.lender ?? '').toUpperCase()
    if (!lender.startsWith(protocol)) continue
    // For Morpho: verify both token addresses appear in the item blob
    if (group.loanToken || group.collateralToken) {
      const blob = JSON.stringify(item).toLowerCase()
      if (group.loanToken      && !blob.includes(group.loanToken.toLowerCase())) continue
      if (group.collateralToken && !blob.includes(group.collateralToken.toLowerCase())) continue
    }
    return item
  }
  return null
}

function getDebtUsd(item: PositionItem): number {
  return ((item.balanceData as Record<string, number> | undefined)?.debt) ?? 0
}

// ── Underlying token resolution ───────────────────────────────────────────────

// Position market entry shape returned by get_user_positions
interface PositionMarket {
  underlying?: string
  collateralEnabled?: boolean
  deposits?: string | number
  debt?: string | number
  collateral?: string | number
}

/**
 * Extracts collateral and debt underlying token addresses from position data.
 *
 * For Morpho: the leaf already encodes the underlying tokens — no position data needed.
 * For Aave / Compound V3: parse the nested `data[0].positions` array that the
 * get_user_positions API returns per-market data including the raw underlying address.
 */
function resolveUnderlying(
  sourceGroup: LeafGroup,
  sourcePosition: PositionItem,
): { collateralToken: Address; debtToken: Address } | null {
  // Morpho: underlying tokens are explicit in the leaf
  if (sourceGroup.loanToken && sourceGroup.collateralToken) {
    return {
      debtToken:       sourceGroup.loanToken as Address,
      collateralToken: sourceGroup.collateralToken as Address,
    }
  }

  // Aave / Compound V3: extract from the nested per-market positions in the API response
  // Shape: item.data[0].positions[] = [{ underlying, collateralEnabled, deposits, debt }]
  const dataArr = (sourcePosition.data as Record<string, unknown>[] | undefined) ?? []
  const accountData = dataArr[0] as Record<string, unknown> | undefined
  const markets = (accountData?.positions as PositionMarket[] | undefined) ?? []

  let collateralToken: Address | null = null
  let debtToken: Address | null = null

  for (const m of markets) {
    const underlying = m.underlying
    if (!underlying) continue
    const addr = underlying.match(/0x[0-9a-fA-F]{40}/)?.[0] as Address | undefined
    if (!addr) continue

    if (!debtToken && parseFloat(String(m.debt ?? 0)) > 0) {
      debtToken = addr
    }
    if (!collateralToken && (m.collateralEnabled || parseFloat(String(m.collateral ?? 0)) > 0 || parseFloat(String(m.deposits ?? 0)) > 0)) {
      collateralToken = addr
    }
  }

  if (!collateralToken || !debtToken) return null
  return { collateralToken, debtToken }
}

// ── Market data ───────────────────────────────────────────────────────────────

interface MarketEntry {
  marketUid?: string   // e.g. "AAVE_V3:42161:0x..." — lender is the first colon-separated segment
  tokenAddress?: string
  depositRate?: number
  variableBorrowRate?: number
  availableLiquidityUsd?: number
  priceUsd?: number
  decimals?: number
}

/** Fetch all lending markets for a chain in a single call and index by (lender-prefix, tokenAddress). */
async function fetchAllMarkets(
  chainId: number,
  oneDeltaClient: Client,
): Promise<MarketEntry[]> {
  try {
    const raw = await callToolRaw(oneDeltaClient, 'get_lending_markets', { chainId: String(chainId), count: 500 })
    const parsed = JSON.parse(raw).markets
    return (parsed ?? []) as MarketEntry[]
  } catch {
    return []
  }
}

function lookupMarketRates(
  markets: MarketEntry[],
  tokenAddress: string,
  protocol: string,
  collateralFilter?: string, // for Morpho: marketUid must contain the collateral token
): MarketEntry | null {
  const proto = protocol.toUpperCase()
  const token = tokenAddress.toLowerCase()

  // lender is not a separate field — extract it from the first segment of marketUid
  // e.g. "COMPOUND_V3_USDT:42161:0x..." → "COMPOUND_V3_USDT"
  let candidates = markets.filter(m => {
    if (m.tokenAddress?.toLowerCase() !== token) return false
    const lenderFromUid = (m.marketUid ?? '').split(':')[0].toUpperCase()
    return lenderFromUid.startsWith(proto)
  })

  if (candidates.length === 0) return null

  // For Morpho, narrow to the specific market by collateral token
  if (collateralFilter && candidates.length > 1) {
    const filtered = candidates.filter(m =>
      (m.marketUid ?? '').toLowerCase().includes(collateralFilter.toLowerCase())
    )
    if (filtered.length > 0) candidates = filtered
  }

  return candidates[0]
}

function getMarketRates(
  markets: MarketEntry[],
  group: LeafGroup,
  collateralToken: string,
  debtToken: string,
  chainId: number,
): MarketRates {
  // For Compound V3, resolve the exact lender name (e.g. COMPOUND_V3_USDT) from the comet address
  // so the marketUid prefix match is exact rather than relying on a generic COMPOUND_V3 prefix.
  const protocol = group.comet
    ? (cometToLender(group.comet, chainId) ?? group.protocol)
    : group.protocol

  const collEntry = lookupMarketRates(markets, collateralToken, protocol)
  const debtEntry = lookupMarketRates(markets, debtToken, protocol, group.collateralToken)

  return {
    collateralDepositRate:   collEntry?.depositRate            ?? null,
    debtBorrowRate:          debtEntry?.variableBorrowRate     ?? null,
    collateralLiquidityUsd:  collEntry?.availableLiquidityUsd  ?? null,
    debtLiquidityUsd:        debtEntry?.availableLiquidityUsd  ?? null,
  }
}

// ── Debt amount in base units ─────────────────────────────────────────────────
// Positions API returns USD values. Compute base units from price + decimals.

function resolveDebtBaseUnits(
  debtUsd: number,
  debtToken: string,
  sourceProtocol: string,
  markets: MarketEntry[],
): string {
  const entry = lookupMarketRates(markets, debtToken, sourceProtocol)
  if (entry?.priceUsd && entry?.decimals) {
    const raw = Math.round((debtUsd / entry.priceUsd) * 10 ** entry.decimals)
    return String(raw)
  }
  // Fallback: USD amount scaled to 6 decimals (stablecoin assumption)
  return String(Math.round(debtUsd * 1e6))
}

// ── Main entry point ──────────────────────────────────────────────────────────

export async function buildSettlementContext(
  order: StoredOrder,
  chainId: number,
  leafDescriptions: LeafDescription[],
  oneDeltaClient: Client,
): Promise<SettlementContext | null> {
  const groups = groupLeaves(leafDescriptions)

  console.log(`\n  Fetching positions for ${order.signer}…`)
  const positions = await fetchAllPositions(order.signer, chainId, oneDeltaClient)

  // ── Collect all viable source candidates ─────────────────
  const sourceCandidates: { group: LeafGroup; position: PositionItem }[] = []
  for (const g of groups) {
    if (g.repayLeafIndex === undefined || g.withdrawLeafIndex === undefined) continue
    const pos = matchPositionForGroup(g, positions)
    if (pos && getDebtUsd(pos) > 0) {
      sourceCandidates.push({ group: g, position: pos })
    }
  }

  if (sourceCandidates.length === 0) {
    console.log('  No source group with active debt found.')
    return null
  }

  // ── Fetch all markets once ────────────────────────────────
  console.log('  Fetching all lending markets…')
  const allMarkets = await fetchAllMarkets(chainId, oneDeltaClient)
  console.log(`  Loaded ${allMarkets.length} market entries`)

  // ── Build options for all source candidates ───────────────
  const options: MigrationOption[] = []

  for (const { group: srcGroup, position: srcPos } of sourceCandidates) {
    const tokens = resolveUnderlying(srcGroup, srcPos)
    if (!tokens) {
      console.log(`  Skipping source ${srcGroup.protocol}: could not resolve tokens`)
      continue
    }
    const { collateralToken, debtToken } = tokens
    const debtUsd = getDebtUsd(srcPos)
    const sourceRates = getMarketRates(allMarkets, srcGroup, collateralToken, debtToken, chainId)
    const srcNetYield =
      sourceRates.collateralDepositRate !== null && sourceRates.debtBorrowRate !== null
        ? sourceRates.collateralDepositRate - sourceRates.debtBorrowRate
        : null
    const lender = String(srcPos.lender ?? srcGroup.protocol)
    const debtAmountBaseUnits = resolveDebtBaseUnits(debtUsd, debtToken, srcGroup.protocol, allMarkets)

    const dests: DestinationInfo[] = []
    for (const g of groups.filter(g => g !== srcGroup && g.depositLeafIndex !== undefined && g.borrowLeafIndex !== undefined)) {
      const rates = getMarketRates(allMarkets, g, collateralToken, debtToken, chainId)
      if (rates.collateralDepositRate !== null || rates.debtBorrowRate !== null) {
        const netYield =
          rates.collateralDepositRate !== null && rates.debtBorrowRate !== null
            ? rates.collateralDepositRate - rates.debtBorrowRate
            : null
        const improvement = netYield !== null && srcNetYield !== null ? netYield - srcNetYield : null
        dests.push({ group: g, rates, netYield, improvement })
      }
    }

    console.log(`  Source ${srcGroup.protocol}: net=${srcNetYield?.toFixed(4)} destinations=${dests.length}`)
    options.push({
      source: { group: srcGroup, lender, collateralToken, debtToken, debtAmountBaseUnits, rates: sourceRates },
      destinations: dests,
    })
  }

  if (options.length === 0) {
    console.log('  No viable migration options found.')
    return null
  }

  console.log(`  ${options.length} source option(s) available`)

  return {
    chainId,
    orderSigner: order.signer,
    options,
  }
}
