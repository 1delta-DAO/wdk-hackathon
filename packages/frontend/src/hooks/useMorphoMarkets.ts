import { useState, useEffect, useMemo } from 'react'
import { PORTAL_PROXY_URL } from '../config/settlements'

const MORPHO_LENDERS = ['MORPHO_BLUE', 'LISTA_DAO']

export interface MorphoMarketParams {
  loanAddress: string
  collateralAddress: string
  oracle: string
  irm: string
  lltv: string
  loanDecimals: number
  collateralDecimals: number
}

export interface MorphoMarketItem {
  chainId: string
  lenderKey: string
  lenderInfo: { key: string; name: string; logoURI?: string }
  totalDepositsUsd: number
  totalDebtUsd: number
  tvlUsd: number
  params: {
    market: MorphoMarketParams & {
      lender: string
      id: string
      fee: string
      rateAtTarget: string
    }
  }
  markets: Array<{
    marketUid: string
    name: string
    totalDepositsUsd: number
    depositRate: number
    variableBorrowRate: number
    utilization: number
  }>
}

interface LatestResponse {
  success: boolean
  data: {
    count: number
    items: MorphoMarketItem[]
  }
}

/**
 * Fetches Morpho Blue and Lista DAO markets from the portal API (lending/latest),
 * which includes params.market with the full market params needed for leaf building.
 */
export function useMorphoMarkets(chainId: number | null, minTvlUsd = 100_000) {
  const [markets, setMarkets] = useState<MorphoMarketItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!chainId) {
      setMarkets([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchMarkets() {
      try {
        const params = new URLSearchParams({
          chains: String(chainId),
          count: '1000',
        })
        for (const lender of MORPHO_LENDERS) {
          params.append('lenders', lender)
        }

        const res = await fetch(
          `${PORTAL_PROXY_URL}/v1/data/lending/latest?${params.toString()}`,
        )
        if (!res.ok) throw new Error(`Failed to fetch markets: ${res.status}`)

        const json: LatestResponse = await res.json()
        if (!json.success) throw new Error('Markets request failed')

        const filtered = json.data.items.filter(m => m.tvlUsd >= minTvlUsd)
        if (!cancelled) setMarkets(filtered)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchMarkets()
    return () => { cancelled = true }
  }, [chainId, minTvlUsd])

  const sortedMarkets = useMemo(
    () => [...markets].sort((a, b) => b.tvlUsd - a.tvlUsd),
    [markets],
  )

  return { markets: sortedMarkets, loading, error }
}
