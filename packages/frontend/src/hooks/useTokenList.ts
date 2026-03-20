import { useState, useEffect } from 'react'

const TOKEN_LIST_BASE = 'https://raw.githubusercontent.com/1delta-DAO/token-lists/main'

export interface TokenMeta {
  name: string
  symbol: string
  logoURI: string
  decimals: number
}

interface TokenListResponse {
  chainId: string
  version: string
  list: Record<string, {
    chainId: number
    decimals: number
    name: string
    address: string
    symbol: string
    logoURI: string
  }>
}

/** Fetches the 1delta token list for a chain. Returns a map of lowercased address -> TokenMeta. */
export function useTokenList(chainId: number | null) {
  const [tokens, setTokens] = useState<Record<string, TokenMeta>>({})
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!chainId) {
      setTokens({})
      return
    }

    let cancelled = false
    setLoading(true)

    async function fetchList() {
      try {
        const res = await fetch(`${TOKEN_LIST_BASE}/${chainId}.json`)
        if (!res.ok) return
        const json: TokenListResponse = await res.json()

        const map: Record<string, TokenMeta> = {}
        for (const [addr, entry] of Object.entries(json.list)) {
          map[addr.toLowerCase()] = {
            name: entry.name,
            symbol: entry.symbol,
            logoURI: entry.logoURI,
            decimals: entry.decimals,
          }
        }
        if (!cancelled) setTokens(map)
      } catch {
        // silently fail — fallback to raw addresses
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchList()
    return () => { cancelled = true }
  }, [chainId])

  return { tokens, loading }
}

/** Look up token metadata with a fallback for unknown tokens */
export function resolveToken(tokens: Record<string, TokenMeta>, address: string): TokenMeta {
  const meta = tokens[address.toLowerCase()]
  if (meta) return meta
  const short = `${address.slice(0, 6)}...${address.slice(-4)}`
  return { name: short, symbol: short, logoURI: '', decimals: 18 }
}
