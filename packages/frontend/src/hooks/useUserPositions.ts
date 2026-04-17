import { useState, useEffect, useCallback } from 'react'
import { PORTAL_PROXY_URL } from '../config/settlements'
import { executeRpcCallsWithRetry, type RpcCall } from './executeRpcCalls'

// ── Domain types ─────────────────────────────────────────────────

export interface AssetInfo {
  chainId: string
  address: string
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}

export interface Position {
  marketUid: string
  deposits: string
  debt: string
  depositsUSD: number
  debtUSD: number
  collateralEnabled: boolean
  underlyingInfo: {
    asset: AssetInfo
    oraclePrice?: { oraclePrice: number; oraclePriceUsd: number }
  }
}

export interface AccountData {
  accountId: string
  health: number
  borrowCapacityUSD: number
  balanceData: {
    deposits: number
    debt: number
    collateral: number
    nav: number
  }
  aprData: {
    apr: number
    depositApr: number
    borrowApr: number
  }
  positions: Position[]
}

export interface LenderPositions {
  lender: string
  chainId: string
  account: string
  data: AccountData[]
}

export type UserDataSummary = Record<string, unknown>

// ── API response types ───────────────────────────────────────────

interface RpcCallApiResponse {
  success: boolean
  data: {
    rpcCallId: string
    rpcCalls: RpcCall[]
  }
  error?: { code: string; message: string }
}

interface ParseApiResponse {
  success: boolean
  data: {
    items: LenderPositions[]
    summary?: UserDataSummary
  }
  error?: { code: string; message: string }
}

export interface FetchUserDataResult {
  data: LenderPositions[]
  summary?: UserDataSummary
}

// ── Helpers ──────────────────────────────────────────────────────

async function fetchApi<T extends { success: boolean; error?: { code: string; message: string } }>(
  label: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`${label} HTTP ${res.status}: ${text || res.statusText}`)
  }
  const json = (await res.json()) as T
  if (!json.success) {
    throw new Error(json.error?.message ?? `${label} API returned success: false`)
  }
  return json
}

// ── Pure fetch function ──────────────────────────────────────────

/**
 * Fetches user lending data via the three-step RPC flow:
 * 1. GET /lending/user-positions/rpc-call → call descriptors
 * 2. Execute each call as eth_call via the user's RPC provider
 * 3. POST /lending/user-positions/parse → structured user data
 */
export async function fetchUserDataViaRpc(
  chainId: string,
  account: string,
): Promise<FetchUserDataResult> {
  const rpcCallUrl =
    `${PORTAL_PROXY_URL}/v1/data/lending/user-positions/rpc-call` +
    `?chains=${chainId}&account=${account}&chunks=500`

  const {
    data: { rpcCallId, rpcCalls },
  } = await fetchApi<RpcCallApiResponse>('rpc-call', rpcCallUrl)

  const rawResponses = await executeRpcCallsWithRetry(chainId, rpcCalls)

  const parseUrl = `${PORTAL_PROXY_URL}/v1/data/lending/user-positions/parse`
  const parseResult = await fetchApi<ParseApiResponse>('parse', parseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rpcCallId, rawResponses }),
  })

  return { data: parseResult.data.items, summary: parseResult.data.summary }
}

// ── Hook ─────────────────────────────────────────────────────────

export function useUserPositions(
  account: string | undefined,
  chainId: number | null,
) {
  const [positions, setPositions] = useState<LenderPositions[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const refetch = useCallback(() => setTick(t => t + 1), [])

  useEffect(() => {
    if (!account || !chainId) return

    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)

    fetchUserDataViaRpc(String(chainId), account)
      .then(result => {
        if (!cancelled) setPositions(result.data)
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [account, chainId, tick])

  const visiblePositions = account && chainId ? positions : []

  return { positions: visiblePositions, loading, error, refetch }
}
