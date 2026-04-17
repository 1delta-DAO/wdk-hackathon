import { useState, useEffect, useCallback } from 'react'
import { PORTAL_PROXY_URL } from '../config/settlements'

// ── Types ────────────────────────────────────────────────────────

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

// ── RPC call response ────────────────────────────────────────────

interface RpcCallResponse {
  success: boolean
  data: {
    rpcCallId: string
    rpcCalls: Array<{
      jsonrpc: string
      id: number
      method: string
      params: [{ to: string; data: string }, string]
    }>
  }
}

interface ParseResponse {
  success: boolean
  data?: {
    items: LenderPositions[]
  }
  error?: { code: string; message: string }
}

// ── RPC URLs per chain (multiple for retry) ──────────────────────

const RPC_URLS: Record<number, string[]> = {
  1: [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
  ],
  10: [
    'https://mainnet.optimism.io',
    'https://rpc.ankr.com/optimism',
  ],
  137: [
    'https://polygon-rpc.com',
    'https://rpc.ankr.com/polygon',
  ],
  42161: [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arb1.lava.build',
    'https://arbitrum.drpc.org',
    'https://arbitrum-one.public.blastapi.io',
    'https://arbitrum.meowrpc.com',
    'https://arbitrum-one-public.nodies.app',
    'https://arbitrum.gateway.tenderly.co',
    'https://arbitrum.public.blockpi.network/v1/rpc/public',
    'https://public-arb-mainnet.fastnode.io',
  ],
  8453: [
    'https://mainnet.base.org',
    'https://base.drpc.org',
  ],
  59144: [
    'https://rpc.linea.build',
  ],
  534352: [
    'https://rpc.scroll.io',
  ],
  5000: [
    'https://rpc.mantle.xyz',
  ],
  56: [
    'https://bsc-dataseed.binance.org',
    'https://bsc-dataseed1.defibit.io',
  ],
}

/**
 * Execute an RPC call with retry across multiple endpoints.
 * Tries each URL once, returns the first successful response.
 */
async function rpcCallWithRetry(
  chainId: number,
  body: unknown,
): Promise<unknown> {
  const urls = RPC_URLS[chainId]
  if (!urls || urls.length === 0) throw new Error(`No RPC URLs for chain ${chainId}`)

  const errors: string[] = []

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        errors.push(`${url}: HTTP ${res.status}`)
        continue
      }
      const json = await res.json()
      // Check for JSON-RPC error in the response
      if (Array.isArray(json)) {
        const hasError = json.some((r: { error?: unknown }) => r.error)
        if (hasError) {
          errors.push(`${url}: JSON-RPC error`)
          continue
        }
      } else if (json.error) {
        errors.push(`${url}: ${json.error.message ?? 'JSON-RPC error'}`)
        continue
      }
      return json
    } catch (e) {
      errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  throw new Error(`All RPCs failed for chain ${chainId}: ${errors.join(' | ')}`)
}

// ── Hook ─────────────────────────────────────────────────────────

/**
 * Fetches user lending positions via a two-step RPC flow:
 *  1. GET  /user-positions/rpc-call  → returns batched eth_call specs
 *  2. Execute the calls on-chain via the chain's public RPC (with retry)
 *  3. POST /user-positions/parse     → returns parsed position data
 */
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
    if (!account || !chainId) {
      setPositions([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchPositions() {
      try {
        // Step 1: Get RPC call specs (no lender filter = all lenders)
        const params = new URLSearchParams({
          account: account!,
          chains: String(chainId),
          batchSize: '4096',
          blockTag: 'latest',
        })

        const rpcCallRes = await fetch(
          `${PORTAL_PROXY_URL}/v1/data/lending/user-positions/rpc-call?${params.toString()}`,
        )
        if (!rpcCallRes.ok) throw new Error(`RPC call endpoint: ${rpcCallRes.status}`)

        const rpcCallData: RpcCallResponse = await rpcCallRes.json()
        if (!rpcCallData.success) throw new Error('Failed to get RPC call spec')

        const { rpcCallId, rpcCalls } = rpcCallData.data

        // Step 2: Execute on-chain with retry across multiple RPCs
        const rawResponses = await rpcCallWithRetry(chainId!, rpcCalls)

        // Step 3: Parse results
        const parseRes = await fetch(
          `${PORTAL_PROXY_URL}/v1/data/lending/user-positions/parse`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rpcCallId, rawResponses }),
          },
        )
        if (!parseRes.ok) throw new Error(`Parse endpoint: ${parseRes.status}`)

        const parsed: ParseResponse = await parseRes.json()
        if (!parsed.success || !parsed.data) {
          throw new Error(parsed.error?.message ?? 'Failed to parse positions')
        }

        if (!cancelled) setPositions(parsed.data.items)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchPositions()
    return () => { cancelled = true }
  }, [account, chainId, tick])

  return { positions, loading, error, refetch }
}
