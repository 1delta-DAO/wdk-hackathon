import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { erc20Abi } from 'viem'
import type { AaveTokenPermission } from '../data/lenders'

interface Props {
  protocolLabel: string
  permissions: AaveTokenPermission[]
  selectedKeys: Set<string>
  onToggle: (key: string) => void
  onSelectAll: (keys: string[]) => void
  chainId: number
}

/** Unique key for a token permission */
export function tokenPermKey(protocolId: string, perm: AaveTokenPermission): string {
  return `${protocolId}:${perm.tokenType}:${perm.tokenAddress}`
}

export function AaveTokenSelector({ protocolLabel, permissions, selectedKeys, onToggle, onSelectAll, chainId }: Props) {
  // Group by underlying
  const byUnderlying = useMemo(() => {
    const map = new Map<string, AaveTokenPermission[]>()
    for (const p of permissions) {
      const group = map.get(p.underlying) ?? []
      group.push(p)
      map.set(p.underlying, group)
    }
    return map
  }, [permissions])

  // Deduplicated underlying addresses for name fetching
  const underlyingAddresses = useMemo(
    () => [...new Set(permissions.map(p => p.underlying))],
    [permissions],
  )

  // Single multicall for all token names — cached by react-query
  const { data: nameResults } = useReadContracts({
    contracts: underlyingAddresses.map(addr => ({
      address: addr,
      abi: erc20Abi,
      functionName: 'symbol' as const,
      chainId,
    })),
    query: {
      staleTime: Infinity,        // token symbols never change
      gcTime: 1000 * 60 * 60,     // keep in cache 1h
      enabled: underlyingAddresses.length > 0,
    },
  })

  // Build address -> symbol lookup
  const tokenSymbols = useMemo(() => {
    const map: Record<string, string> = {}
    if (!nameResults) return map
    for (let i = 0; i < underlyingAddresses.length; i++) {
      const r = nameResults[i]
      if (r.status === 'success' && typeof r.result === 'string') {
        map[underlyingAddresses[i]] = r.result
      }
    }
    return map
  }, [nameResults, underlyingAddresses])

  const allPermKeys = useMemo(
    () => Array.from(byUnderlying.values()).flat().map(p => `${p.tokenType}:${p.tokenAddress}`),
    [byUnderlying],
  )

  const selectedCount = permissions.filter(p => selectedKeys.has(`${p.tokenType}:${p.tokenAddress}`)).length
  const totalCount = permissions.length

  return (
    <div className="border border-gray-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 bg-gray-900/80 border-b border-gray-800 flex items-center justify-between">
        <span className="text-sm font-medium text-purple-300">{protocolLabel}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">{selectedCount}/{totalCount}</span>
          <button
            onClick={() => onSelectAll(allPermKeys)}
            className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            {selectedCount === totalCount ? 'Deselect all' : 'Select all'}
          </button>
        </div>
      </div>

      {/* Token list */}
      <div className="max-h-80 overflow-y-auto divide-y divide-gray-800/50">
        {Array.from(byUnderlying.entries()).map(([underlying, perms]) => {
          const symbol = tokenSymbols[underlying]
          const shortAddr = `${underlying.slice(0, 6)}...${underlying.slice(-4)}`

          return (
            <div key={underlying} className="px-4 py-2">
              <div className="text-xs font-medium text-gray-400 mb-1">
                {symbol ?? shortAddr}
                {symbol && <span className="text-gray-600 ml-1.5">{shortAddr}</span>}
              </div>
              <div className="flex gap-2">
                {perms.map((perm) => {
                  const key = `${perm.tokenType}:${perm.tokenAddress}`
                  const selected = selectedKeys.has(key)
                  const isCollateral = perm.tokenType === 'aToken'

                  return (
                    <button
                      key={key}
                      onClick={() => onToggle(key)}
                      className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-all border ${
                        selected
                          ? isCollateral
                            ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                            : 'bg-orange-500/15 border-orange-500/40 text-orange-300'
                          : 'bg-gray-900/50 border-gray-700 text-gray-500 hover:border-gray-600'
                      }`}
                    >
                      <div
                        className={`w-3 h-3 rounded-sm border flex items-center justify-center ${
                          selected
                            ? isCollateral ? 'border-emerald-500 bg-emerald-500' : 'border-orange-500 bg-orange-500'
                            : 'border-gray-600'
                        }`}
                      >
                        {selected && (
                          <svg className="w-2 h-2 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </div>
                      {isCollateral ? 'aToken (Permit)' : 'vToken (Delegation)'}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
