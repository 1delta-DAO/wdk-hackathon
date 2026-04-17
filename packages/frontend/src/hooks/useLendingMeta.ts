import { useState, useEffect } from 'react'
import { PORTAL_PROXY_URL } from '../config/settlements'

export interface LenderInfo {
  key: string
  name: string
  logoURI?: string
  tvlUsd?: number
}

interface LatestItem {
  lenderKey: string
  lenderInfo: { key: string; name: string; logoURI?: string }
  tvlUsd?: number
}

interface LatestResponse {
  success: boolean
  data: {
    count: number
    items: LatestItem[]
  }
}

interface LendersListResponse {
  success: boolean
  data: {
    items: Array<{ key: string }>
  }
}

/**
 * Fetches lender metadata from the portal lending/latest endpoint.
 * Returns a map of lenderKey -> LenderInfo, covering all protocol families.
 */
export function useLendingMeta(chainId: number | null) {
  const [lenders, setLenders] = useState<Record<string, LenderInfo>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!chainId) {
      setLenders({})
      return
    }

    let cancelled = false
    setLoading(true)

    async function fetchMeta() {
      try {
        // Step 1: enumerate available lender keys for this chain
        const lendersRes = await fetch(
          `${PORTAL_PROXY_URL}/v1/data/lending/lenders?chains=${chainId}`,
        )
        if (!lendersRes.ok) return
        const lendersJson: LendersListResponse = await lendersRes.json()
        if (!lendersJson.success) return

        const keys = lendersJson.data.items.map(l => l.key).filter(Boolean)
        if (keys.length === 0) {
          if (!cancelled) setLenders({})
          return
        }

        // Step 2: fetch latest metadata/TVL for those lenders
        const params = new URLSearchParams({
          chains: String(chainId),
          count: '1000',
        })
        for (const k of keys) params.append('lenders', k)

        const res = await fetch(
          `${PORTAL_PROXY_URL}/v1/data/lending/latest?${params.toString()}`,
        )
        if (!res.ok) return

        const json: LatestResponse = await res.json()
        if (!json.success) return

        const map: Record<string, LenderInfo> = {}
        for (const item of json.data.items) {
          if (!item.lenderInfo) continue
          if (!map[item.lenderKey]) {
            map[item.lenderKey] = { ...item.lenderInfo, tvlUsd: item.tvlUsd ?? 0 }
          } else {
            map[item.lenderKey].tvlUsd = (map[item.lenderKey].tvlUsd ?? 0) + (item.tvlUsd ?? 0)
          }
        }
        if (!cancelled) setLenders(map)
      } catch {
        // silently fail — fallback to raw protocol IDs
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchMeta()
    return () => { cancelled = true }
  }, [chainId])

  return { lenders, loading }
}

/** Look up lender info with a fallback for unknown protocols */
export function resolveLender(lenders: Record<string, LenderInfo>, protocolId: string): LenderInfo {
  const info = lenders[protocolId]
  if (info) return info
  return {
    key: protocolId,
    name: protocolId.replace(/_/g, ' '),
  }
}
