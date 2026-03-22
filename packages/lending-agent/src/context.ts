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
import { cometToLender, ONEDELTA_PORTAL_URL, ONEDELTA_PORTAL_API_KEY } from './config.js'

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
      extra.loanToken       = leaf.loanToken
      extra.collateralToken = leaf.collateralToken
      extra.lltv            = leaf.lltv
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
    // For pool-based protocols, there may be multiple REPAY/WITHDRAW leaves at the same pool.
    // We store the last-seen indices here as defaults; buildSettlementContext will correct them
    // for pool-based groups using the wrapper-token → underlying map from the portal API.
    if (leaf.op === 'REPAY')    { g.repayLeafIndex    = leaf.index; if (leaf.vToken) g.aaveDebtToken = leaf.vToken }
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

// ── Market data (portal API) ───────────────────────────────────────────────────

interface MarketEntry {
  marketUid?: string   // e.g. "AAVE_V3:42161:0x..." — lender is the first colon-separated segment
  tokenAddress?: string
  depositRate?: number
  variableBorrowRate?: number
  availableLiquidityUsd?: number
  priceUsd?: number
  decimals?: number
}

/**
 * Fetches all lending markets from the portal API in a single call.
 * Returns both the flat market entries (for rate lookups) and a wrapper-token → underlying
 * address map (for resolving which aToken/vToken leaf corresponds to which underlying asset).
 */
async function fetchAllMarkets(chainId: number): Promise<{
  markets: MarketEntry[]
  wrapperMap: Map<string, string>
}> {
  const markets: MarketEntry[] = []
  const wrapperMap = new Map<string, string>()

  try {
    const url = `${ONEDELTA_PORTAL_URL}/v1/data/lending/latest?chainIds=${chainId}`
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (ONEDELTA_PORTAL_API_KEY) headers['x-api-key'] = ONEDELTA_PORTAL_API_KEY

    const res = await fetch(url, { headers })
    if (!res.ok) return { markets, wrapperMap }

    const body = await res.json() as { data?: { items?: unknown[] } }
    const items = (body?.data?.items ?? []) as Record<string, unknown>[]

    for (const item of items) {
      const lenderKey = String(item.lenderKey ?? '')
      const rawMarkets = (item.markets as Record<string, unknown>[] | undefined) ?? []

      for (const m of rawMarkets) {
        const underlyingInfo = m.underlyingInfo as Record<string, unknown> | undefined
        const asset = underlyingInfo?.asset as Record<string, unknown> | undefined
        const underlyingAddr = asset?.address as string | undefined
        if (!underlyingAddr) continue

        const u = underlyingAddr.toLowerCase()

        // Build MarketEntry for rate lookups
        const prices = underlyingInfo?.prices as Record<string, unknown> | undefined
        markets.push({
          marketUid:             m.marketUid as string | undefined,
          tokenAddress:          underlyingAddr,
          depositRate:           m.depositRate as number | undefined,
          variableBorrowRate:    m.variableBorrowRate as number | undefined,
          availableLiquidityUsd: (m.withdrawLiquidity ?? m.totalLiquidityUsd) as number | undefined,
          priceUsd:              prices?.priceUsd as number | undefined,
          decimals:              asset?.decimals as number | undefined,
        })

        // Build wrapper token → underlying map
        const metadata = (m.params as Record<string, unknown> | undefined)?.metadata as Record<string, string> | undefined
        if (metadata) {
          for (const key of ['aToken', 'vToken', 'sToken'] as const) {
            const addr = metadata[key]
            if (addr && addr !== '0x0000000000000000000000000000000000000000') {
              wrapperMap.set(addr.toLowerCase(), u)
            }
          }
        }
      }

      void lenderKey // referenced to avoid unused-var lint on future use
    }
  } catch {
    // Non-fatal — rates will be null, leaf indices fall back to groupLeaves defaults
  }

  return { markets, wrapperMap }
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

// Extended shape of position market entries returned by get_user_positions
interface PositionMarketFull extends PositionMarket {
  underlyingInfo?: { asset?: { decimals?: number } }
}

/**
 * Extracts the exact debt amount in base units from the position data.
 *
 * The API returns `debt` as a token-unit string (e.g. "1.30019") alongside
 * `underlyingInfo.asset.decimals`, so we can reconstruct the exact base-unit
 * amount without any USD conversion or RPC calls.
 *
 * Falls back to USD-based estimation if the position entry is missing.
 */
function resolveDebtBaseUnits(
  sourcePosition: PositionItem,
  debtToken: string,
  sourceProtocol: string,
  markets: MarketEntry[],
): string {
  const dataArr = (sourcePosition.data as Record<string, unknown>[] | undefined) ?? []
  const accountData = dataArr[0] as Record<string, unknown> | undefined
  const posMarkets = (accountData?.positions as PositionMarketFull[] | undefined) ?? []

  for (const m of posMarkets) {
    if (!m.underlying) continue
    const addr = m.underlying.match(/0x[0-9a-fA-F]{40}/)?.[0]
    if (!addr || addr.toLowerCase() !== debtToken.toLowerCase()) continue

    const debtStr = String(m.debt ?? '0')
    const debtAmount = parseFloat(debtStr)
    if (debtAmount <= 0) continue

    const decimals = m.underlyingInfo?.asset?.decimals
    if (decimals !== undefined) {
      return String(Math.round(debtAmount * 10 ** decimals))
    }
  }

  // Fallback: derive from USD value via market price
  const debtUsd = getDebtUsd(sourcePosition)
  const entry = lookupMarketRates(markets, debtToken, sourceProtocol)
  if (entry?.priceUsd && entry?.decimals) {
    return String(Math.round((debtUsd / entry.priceUsd) * 10 ** entry.decimals))
  }
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

  // ── Fetch all markets + wrapper token map ────────────────
  console.log('  Fetching all lending markets…')
  const { markets: allMarkets, wrapperMap } = await fetchAllMarkets(chainId)
  console.log(`  Loaded ${allMarkets.length} market entries, ${wrapperMap.size} wrapper token mappings`)

  // ── Build options for all source candidates ───────────────
  const options: MigrationOption[] = []

  for (const { group: srcGroup, position: srcPos } of sourceCandidates) {
    const tokens = resolveUnderlying(srcGroup, srcPos)
    if (!tokens) {
      console.log(`  Skipping source ${srcGroup.protocol}: could not resolve tokens`)
      continue
    }
    const { collateralToken, debtToken } = tokens

    // For pool-based protocols (Aave), the order may contain multiple REPAY/WITHDRAW leaves
    // at the same pool for different assets. Use the wrapper token map to find the correct
    // leaf — the one whose wrapped token resolves to the user's actual debt/collateral underlying.
    if (srcGroup.pool && wrapperMap.size > 0) {
      const poolNorm = srcGroup.pool.toLowerCase()
      const debtNorm = debtToken.toLowerCase()
      const collNorm = collateralToken.toLowerCase()

      const repayMatch = leafDescriptions.find(l =>
        l.op === 'REPAY' && l.pool?.toLowerCase() === poolNorm && l.vToken &&
        wrapperMap.get(l.vToken.toLowerCase()) === debtNorm,
      )
      const withdrawMatch = leafDescriptions.find(l =>
        l.op === 'WITHDRAW' && l.pool?.toLowerCase() === poolNorm && l.aToken &&
        wrapperMap.get(l.aToken.toLowerCase()) === collNorm,
      )

      if (repayMatch)    { srcGroup.repayLeafIndex    = repayMatch.index;    srcGroup.aaveDebtToken = repayMatch.vToken }
      if (withdrawMatch) { srcGroup.withdrawLeafIndex = withdrawMatch.index; srcGroup.aToken        = withdrawMatch.aToken }

      console.log(`  Resolved pool leaves: repay[${repayMatch?.index ?? 'no match'}] withdraw[${withdrawMatch?.index ?? 'no match'}]`)
    }

    const sourceRates = getMarketRates(allMarkets, srcGroup, collateralToken, debtToken, chainId)
    const srcNetYield =
      sourceRates.collateralDepositRate !== null && sourceRates.debtBorrowRate !== null
        ? sourceRates.collateralDepositRate - sourceRates.debtBorrowRate
        : null
    const lender = String(srcPos.lender ?? srcGroup.protocol)
    const debtAmountBaseUnits = resolveDebtBaseUnits(srcPos, debtToken, srcGroup.protocol, allMarkets)

    const debtNormalized = debtToken.toLowerCase()
    const collNormalized = collateralToken.toLowerCase()

    const dests: DestinationInfo[] = []
    for (const g of groups.filter(g => {
      if (g === srcGroup || g.depositLeafIndex === undefined || g.borrowLeafIndex === undefined) return false
      // For Morpho Blue the leaf encodes exact tokens — filter directly rather than relying on market lookup
      if (g.loanToken && g.collateralToken) {
        return g.loanToken.toLowerCase() === debtNormalized &&
               g.collateralToken.toLowerCase() === collNormalized
      }
      return true
    })) {
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
