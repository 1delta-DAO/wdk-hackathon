/**
 * Order backend client and StoredOrder → LendingIntent decoder.
 *
 * Decodes merkle leaves to extract:
 *   - Which lenders the user approved (numeric ID → 1delta string)
 *   - Pool / aToken / debtToken addresses (Aave)
 *   - Market params (Morpho)
 *
 * Token addresses for find_market come from get_user_positions, not leaves.
 * Leaves give us the protocol-level addresses (pool, aToken, debtToken) needed
 * to build migration calldata with the settlement-sdk.
 */

import { getAddress } from 'viem'
import type { Hex, Address } from 'viem'
import { LenderIds, LenderOps } from '@1delta/settlement-sdk'
import type { MorphoMarketParams } from '@1delta/settlement-sdk'
import type { LendingIntent } from './main.js'

interface AaveMarketInfo {
  oneDeltaLenderId: string
  tokenAddress: Address
  pool: Address
  aToken: Address
  debtToken: Address
}

interface MorphoMarketInfo {
  oneDeltaLenderId: string
  tokenAddress: Address
  morpho: Address
  market: MorphoMarketParams
}


// ─── Types mirrored from order-backend ───────────────────────────────────────

export interface MerkleLeaf {
  op: number
  lender: number
  data: Hex
  leaf: Hex
  proof: Hex[]
}

export interface StoredOrder {
  id: string
  createdAt: number
  status: 'open' | 'filled' | 'cancelled' | 'expired'
  signer: Address
  signature: Hex
  order: {
    merkleRoot: Hex
    deadline: number
    settlementData: Hex
    orderData: Hex
    executionData: Hex
    fillerCalldata: Hex
    chainId: number
    maxFeeBps: number
    leaves: MerkleLeaf[]
  }
}

// ─── Numeric lender ID → 1delta string ───────────────────────────────────────

/**
 * Maps a numeric settlement lender ID back to the 1delta API lender string.
 * The numeric ID is a range lower-bound; we return the most common protocol name.
 */
export function fromSettlementLenderId(numericId: number): string {
  if (numericId < LenderIds.UP_TO_AAVE_V3)     return 'AAVE_V3'     // 0–999
  if (numericId < LenderIds.UP_TO_AAVE_V2)     return 'AAVE_V2'     // 1000–1999
  if (numericId < LenderIds.UP_TO_COMPOUND_V3) return 'COMPOUND_V3' // 2000–2999
  if (numericId < LenderIds.UP_TO_COMPOUND_V2) return 'COMPOUND_V2' // 3000–3999
  if (numericId < LenderIds.UP_TO_MORPHO)      return 'MORPHO_BLUE' // 4000–4999
  if (numericId < LenderIds.UP_TO_SILO_V2)     return 'SILO_V2'     // 5000–5999
  throw new Error(`Unknown numeric lender ID: ${numericId}`)
}

// ─── Lender family checks ─────────────────────────────────────────────────────

function isAaveLender(numericId: number): boolean {
  return numericId < LenderIds.UP_TO_AAVE_V2 // 0–1999
}

function isMorphoLender(numericId: number): boolean {
  return numericId >= LenderIds.UP_TO_COMPOUND_V2 && numericId < LenderIds.UP_TO_MORPHO // 4000–4999
}

// ─── Leaf data decoders ───────────────────────────────────────────────────────

function addrAt(data: Hex, byteOffset: number): Address {
  return getAddress(`0x${data.slice(2 + byteOffset * 2, 2 + (byteOffset + 20) * 2)}`)
}

export interface DecodedAaveDeposit  { pool: Address }
export interface DecodedAaveBorrow   { mode: number; pool: Address }
export interface DecodedAaveRepay    { mode: number; debtToken: Address; pool: Address }
export interface DecodedAaveWithdraw { aToken: Address; pool: Address }

export interface DecodedMorphoAction {
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
  flags: number
  morpho: Address
}

// DEPOSIT: [20: pool]
export function decodeAaveDeposit(data: Hex): DecodedAaveDeposit {
  return { pool: addrAt(data, 0) }
}

// BORROW: [1: mode][20: pool]
export function decodeAaveBorrow(data: Hex): DecodedAaveBorrow {
  const raw = data.slice(2)
  return {
    mode: parseInt(raw.slice(0, 2), 16),
    pool: getAddress(`0x${raw.slice(2, 42)}`),
  }
}

// REPAY: [1: mode][20: debtToken][20: pool]
export function decodeAaveRepay(data: Hex): DecodedAaveRepay {
  const raw = data.slice(2)
  return {
    mode:      parseInt(raw.slice(0, 2), 16),
    debtToken: getAddress(`0x${raw.slice(2, 42)}`),
    pool:      getAddress(`0x${raw.slice(42, 82)}`),
  }
}

// WITHDRAW: [20: aToken][20: pool]
export function decodeAaveWithdraw(data: Hex): DecodedAaveWithdraw {
  return {
    aToken: addrAt(data, 0),
    pool:   addrAt(data, 20),
  }
}

// All Morpho ops: [20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho]
export function decodeMorphoAction(data: Hex): DecodedMorphoAction {
  const raw = data.slice(2)
  return {
    loanToken:       getAddress(`0x${raw.slice(0,   40)}`),
    collateralToken: getAddress(`0x${raw.slice(40,  80)}`),
    oracle:          getAddress(`0x${raw.slice(80,  120)}`),
    irm:             getAddress(`0x${raw.slice(120, 160)}`),
    lltv:            BigInt(`0x${raw.slice(160, 192)}`),
    flags:           parseInt(raw.slice(192, 194), 16),
    morpho:          getAddress(`0x${raw.slice(194, 234)}`),
  }
}

// ─── Decode leaves → MarketInfo ───────────────────────────────────────────────

/**
 * Reconstructs source and destination MarketInfo from the order's merkle leaves.
 *
 * Convention: REPAY+WITHDRAW leaves = source, DEPOSIT+BORROW leaves = dest.
 * Returns null for either side if the corresponding leaves are absent (e.g.
 * deposit-only orders have no source, borrow-only have no dest collateral).
 */
export function decodeMarketInfoFromLeaves(leaves: MerkleLeaf[]): {
  source: AaveMarketInfo | MorphoMarketInfo | null
  dest: AaveMarketInfo | MorphoMarketInfo | null
} {
  const repayLeaf    = leaves.find(l => l.op === LenderOps.REPAY)
  const withdrawLeaf = leaves.find(l => l.op === LenderOps.WITHDRAW)
  const depositLeaf  = leaves.find(l => l.op === LenderOps.DEPOSIT)
  const borrowLeaf   = leaves.find(l => l.op === LenderOps.BORROW)

  function buildAaveMarket(
    repay: MerkleLeaf | undefined,
    withdraw: MerkleLeaf | undefined,
    deposit: MerkleLeaf | undefined,
    lenderLeaf: MerkleLeaf,
  ): AaveMarketInfo {
    const repayDecoded    = repay    ? decodeAaveRepay(repay.data)       : null
    const withdrawDecoded = withdraw ? decodeAaveWithdraw(withdraw.data) : null
    const depositDecoded  = deposit  ? decodeAaveDeposit(deposit.data)   : null

    const zero = '0x0000000000000000000000000000000000000000' as Address
    const pool      = (repayDecoded?.pool ?? withdrawDecoded?.pool ?? depositDecoded?.pool ?? zero) as Address
    const aToken    = (withdrawDecoded?.aToken ?? zero) as Address
    const debtToken = (repayDecoded?.debtToken ?? zero) as Address

    return {
      oneDeltaLenderId: fromSettlementLenderId(lenderLeaf.lender),
      tokenAddress: debtToken, // underlying resolved later via get_user_positions
      pool,
      aToken,
      debtToken,
    }
  }

  function buildMorphoMarket(leaf: MerkleLeaf): MorphoMarketInfo {
    const decoded = decodeMorphoAction(leaf.data)
    const market: MorphoMarketParams = {
      loanToken:       decoded.loanToken,
      collateralToken: decoded.collateralToken,
      oracle:          decoded.oracle,
      irm:             decoded.irm,
      lltv:            decoded.lltv,
    }
    return {
      oneDeltaLenderId: fromSettlementLenderId(leaf.lender),
      tokenAddress: decoded.loanToken,
      morpho: decoded.morpho,
      market,
    }
  }

  // Source = where the existing position lives (repay + withdraw)
  let source: AaveMarketInfo | MorphoMarketInfo | null = null
  if (repayLeaf || withdrawLeaf) {
    const anchor = repayLeaf ?? withdrawLeaf!
    if (isAaveLender(anchor.lender)) {
      source = buildAaveMarket(repayLeaf, withdrawLeaf, undefined, anchor)
    } else if (isMorphoLender(anchor.lender)) {
      source = buildMorphoMarket(anchor)
    }
  }

  // Dest = where the position should move (deposit + borrow)
  let dest: AaveMarketInfo | MorphoMarketInfo | null = null
  if (depositLeaf || borrowLeaf) {
    const anchor = depositLeaf ?? borrowLeaf!
    if (isAaveLender(anchor.lender)) {
      dest = buildAaveMarket(undefined, undefined, depositLeaf, anchor)
    } else if (isMorphoLender(anchor.lender)) {
      dest = buildMorphoMarket(anchor)
    }
  }

  return { source, dest }
}

// ─── StoredOrder → LendingIntent ─────────────────────────────────────────────

/**
 * Derives a LendingIntent from a StoredOrder.
 *
 * Allowed lenders: unique numeric lender IDs across all leaves → 1delta strings.
 *
 * Assets:
 *   - Morpho leaves encode underlyings directly (loanToken = debt, collateralToken = collateral).
 *   - Aave leaves encode protocol tokens (aToken, variableDebtToken), not underlyings.
 *     For Aave we populate the protocol token addresses and rely on the agent to resolve
 *     the actual underlying via get_user_positions (which returns underlying asset info).
 *
 * Source = REPAY + WITHDRAW leaves (existing position).
 * Dest   = DEPOSIT + BORROW leaves (target position — may differ from source lender).
 * The collateral/debt assets are read from the SOURCE side since that's what the
 * agent needs to find and optimize.
 */
export function orderToIntent(order: StoredOrder): LendingIntent {
  const leaves = order.order.leaves

  const uniqueNumericLenders = [...new Set(leaves.map(l => l.lender))]
  const allowedLenders = uniqueNumericLenders.map(fromSettlementLenderId)

  const repayLeaf    = leaves.find(l => l.op === LenderOps.REPAY)
  const withdrawLeaf = leaves.find(l => l.op === LenderOps.WITHDRAW)
  const depositLeaf  = leaves.find(l => l.op === LenderOps.DEPOSIT)
  const borrowLeaf   = leaves.find(l => l.op === LenderOps.BORROW)

  // Use source leaves first; fall back to dest leaves for deposit-only orders
  const collateralLeaf = withdrawLeaf ?? depositLeaf
  const debtLeaf       = repayLeaf    ?? borrowLeaf

  let collateralToken = ''
  if (collateralLeaf) {
    if (isMorphoLender(collateralLeaf.lender)) {
      collateralToken = decodeMorphoAction(collateralLeaf.data).collateralToken
    } else if (isAaveLender(collateralLeaf.lender) && collateralLeaf.op === LenderOps.WITHDRAW) {
      // aToken address — agent resolves underlying via get_user_positions
      collateralToken = decodeAaveWithdraw(collateralLeaf.data).aToken
    }
  }

  let debtToken = ''
  if (debtLeaf) {
    if (isMorphoLender(debtLeaf.lender)) {
      debtToken = decodeMorphoAction(debtLeaf.data).loanToken
    } else if (isAaveLender(debtLeaf.lender) && debtLeaf.op === LenderOps.REPAY) {
      // variableDebtToken address — agent resolves underlying via get_user_positions
      debtToken = decodeAaveRepay(debtLeaf.data).debtToken
    }
  }

  return {
    signature: order.signature,
    orderId:   order.id,
    chainId:   order.order.chainId,
    collateralToken,
    debtToken,
    allowedLenders,
  }
}

// ─── Leaf descriptions for the agent ─────────────────────────────────────────

const OP_NAMES: Record<number, string> = {
  0: 'DEPOSIT', 1: 'BORROW', 2: 'REPAY', 3: 'WITHDRAW',
  4: 'DEPOSIT_LENDING_TOKEN', 5: 'WITHDRAW_LENDING_TOKEN',
}

export interface LeafDescription {
  index: number
  op: string
  protocol: string
  lender: number
  // Aave fields
  pool?: string
  aToken?: string
  debtToken?: string
  // Morpho fields
  loanToken?: string
  collateralToken?: string
  lltv?: string
  oracle?: string
  morpho?: string
}

/**
 * Produces a human-readable description of each leaf for the agent prompt.
 * The index matches order.leaves[index] so the agent can reference leaves by index.
 */
export function describeLeaves(leaves: MerkleLeaf[]): LeafDescription[] {
  return leaves.map((leaf, index) => {
    const protocol = fromSettlementLenderId(leaf.lender)
    const base: LeafDescription = { index, op: OP_NAMES[leaf.op] ?? String(leaf.op), protocol, lender: leaf.lender }

    if (isAaveLender(leaf.lender)) {
      if (leaf.op === 0 /* DEPOSIT */) {
        const d = decodeAaveDeposit(leaf.data)
        return { ...base, pool: d.pool }
      }
      if (leaf.op === 1 /* BORROW */) {
        const d = decodeAaveBorrow(leaf.data)
        return { ...base, pool: d.pool }
      }
      if (leaf.op === 2 /* REPAY */) {
        const d = decodeAaveRepay(leaf.data)
        return { ...base, debtToken: d.debtToken, pool: d.pool }
      }
      if (leaf.op === 3 /* WITHDRAW */) {
        const d = decodeAaveWithdraw(leaf.data)
        return { ...base, aToken: d.aToken, pool: d.pool }
      }
    }

    if (isMorphoLender(leaf.lender)) {
      const d = decodeMorphoAction(leaf.data)
      const lltvPct = (Number(d.lltv) / 1e16).toFixed(2) + '%'
      return {
        ...base,
        loanToken: d.loanToken,
        collateralToken: d.collateralToken,
        oracle: d.oracle,
        lltv: lltvPct,
        morpho: d.morpho,
      }
    }

    return base
  })
}

// ─── Backend client ───────────────────────────────────────────────────────────

const ORDER_BACKEND_URL = process.env.ORDER_BACKEND_URL ?? 'http://localhost:8787'

export async function fetchOpenOrders(chainId: number, signer?: Address): Promise<StoredOrder[]> {
  const url = new URL(`${ORDER_BACKEND_URL}/v1/orders`)
  url.searchParams.set('chainId', String(chainId))
  url.searchParams.set('status', 'open')
  if (signer) url.searchParams.set('signer', signer)

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Order backend error: ${res.status} ${await res.text()}`)

  const data = await res.json() as { orders: StoredOrder[] }
  return data.orders
}

export async function fetchOrder(id: string, chainId: number): Promise<StoredOrder> {
  const url = new URL(`${ORDER_BACKEND_URL}/v1/orders/${id}`)
  url.searchParams.set('chainId', String(chainId))

  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Order backend error: ${res.status} ${await res.text()}`)

  return res.json() as Promise<StoredOrder>
}

export async function markOrderFilled(id: string, chainId: number): Promise<void> {
  const url = new URL(`${ORDER_BACKEND_URL}/v1/orders/${id}`)
  url.searchParams.set('chainId', String(chainId))

  const res = await fetch(url.toString(), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'filled' }),
  })
  if (!res.ok) throw new Error(`Failed to mark order filled: ${res.status} ${await res.text()}`)
}
