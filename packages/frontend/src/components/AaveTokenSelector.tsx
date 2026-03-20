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
  const byUnderlying = useMemo(() => {
    const map = new Map<string, AaveTokenPermission[]>()
    for (const p of permissions) {
      const group = map.get(p.underlying) ?? []
      group.push(p)
      map.set(p.underlying, group)
    }
    return map
  }, [permissions])

  const underlyingAddresses = useMemo(
    () => [...new Set(permissions.map(p => p.underlying))],
    [permissions],
  )

  const { data: nameResults } = useReadContracts({
    contracts: underlyingAddresses.map(addr => ({
      address: addr,
      abi: erc20Abi,
      functionName: 'symbol' as const,
      chainId,
    })),
    query: {
      staleTime: Infinity,
      gcTime: 1000 * 60 * 60,
      enabled: underlyingAddresses.length > 0,
    },
  })

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
    <div className="card card-compact bg-base-200 border border-base-300">
      <div className="card-body p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
          <span className="text-sm font-semibold text-secondary">{protocolLabel}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-base-content/40">{selectedCount}/{totalCount}</span>
            <button
              onClick={() => onSelectAll(allPermKeys)}
              className="link link-primary text-xs no-underline"
            >
              {selectedCount === totalCount ? 'Deselect all' : 'Select all'}
            </button>
          </div>
        </div>

        {/* Token list */}
        <div className="max-h-64 overflow-y-auto divide-y divide-base-300">
          {Array.from(byUnderlying.entries()).map(([underlying, perms]) => {
            const symbol = tokenSymbols[underlying]
            const shortAddr = `${underlying.slice(0, 6)}...${underlying.slice(-4)}`

            return (
              <div key={underlying} className="px-3 py-1.5">
                <div className="text-xs font-medium text-base-content/60 mb-1">
                  {symbol ?? shortAddr}
                  {symbol && <span className="text-base-content/30 ml-1.5">{shortAddr}</span>}
                </div>
                <div className="flex gap-1.5">
                  {perms.map((perm) => {
                    const key = `${perm.tokenType}:${perm.tokenAddress}`
                    const selected = selectedKeys.has(key)
                    const isCollateral = perm.tokenType === 'aToken'

                    return (
                      <button
                        key={key}
                        onClick={() => onToggle(key)}
                        className={`btn btn-xs gap-1 ${
                          selected
                            ? isCollateral ? 'btn-success btn-outline' : 'btn-warning btn-outline'
                            : 'btn-ghost'
                        }`}
                      >
                        <input
                          type="checkbox"
                          className={`checkbox checkbox-xs ${isCollateral ? 'checkbox-success' : 'checkbox-warning'}`}
                          checked={selected}
                          readOnly
                        />
                        {isCollateral ? 'aToken' : 'vToken'}
                      </button>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
