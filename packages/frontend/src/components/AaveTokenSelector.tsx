import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { erc20Abi } from 'viem'
import type { AaveTokenPermission } from '../data/lenders'
import { useTokenList } from '../hooks/useTokenList'

/** Token icon using logoURI from the token list API, with fallback to a colored circle */
function TokenIcon({ logoURI, symbol, size = 18 }: { logoURI?: string; symbol?: string; size?: number }) {
  if (!logoURI) {
    const letter = symbol ? symbol[0].toUpperCase() : '?'
    return (
      <span
        className="inline-flex items-center justify-center rounded-full bg-base-content/10 text-base-content/50 shrink-0"
        style={{ width: size, height: size, fontSize: size * 0.55, fontWeight: 700 }}
      >
        {letter}
      </span>
    )
  }

  return (
    <img
      src={logoURI}
      alt={symbol ?? ''}
      width={size}
      height={size}
      className="rounded-full shrink-0"
    />
  )
}

interface Props {
  protocolLabel: string
  permissions: AaveTokenPermission[]
  selectedKeys: Set<string>
  onToggle: (key: string) => void
  onSelectAll: (keys: string[]) => void
  chainId: number
}

export function tokenPermKey(protocolId: string, perm: AaveTokenPermission): string {
  return `${protocolId}:${perm.tokenType}:${perm.tokenAddress}`
}

export function AaveTokenSelector({ protocolLabel, permissions, selectedKeys, onToggle, onSelectAll, chainId }: Props) {
  const { tokens } = useTokenList(chainId)

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
      address: addr, abi: erc20Abi, functionName: 'symbol' as const, chainId,
    })),
    query: { staleTime: Infinity, gcTime: 3600_000, enabled: underlyingAddresses.length > 0 },
  })

  const tokenSymbols = useMemo(() => {
    const map: Record<string, string> = {}
    if (!nameResults) return map
    for (let i = 0; i < underlyingAddresses.length; i++) {
      const r = nameResults[i]
      if (r.status === 'success' && typeof r.result === 'string') map[underlyingAddresses[i]] = r.result
    }
    return map
  }, [nameResults, underlyingAddresses])

  const allPermKeys = useMemo(
    () => Array.from(byUnderlying.values()).flat().map(p => `${p.tokenType}:${p.tokenAddress}`),
    [byUnderlying],
  )

  const selectedCount = permissions.filter(p => selectedKeys.has(`${p.tokenType}:${p.tokenAddress}`)).length

  return (
    <div className="bg-base-300/50 rounded border border-base-300 overflow-hidden">
      <div className="flex items-center justify-between px-2 py-1 border-b border-base-300/60">
        <span className="text-xs font-semibold text-secondary">{protocolLabel}</span>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-base-content/30">{selectedCount}/{permissions.length}</span>
          <button onClick={() => onSelectAll(allPermKeys)} className="link link-primary text-[10px] no-underline">
            {selectedCount === permissions.length ? 'None' : 'All'}
          </button>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto divide-y divide-base-300/30">
        {Array.from(byUnderlying.entries()).map(([underlying, perms]) => {
          const meta = tokens[underlying.toLowerCase()]
          const symbol = meta?.symbol ?? tokenSymbols[underlying]
          const shortAddr = `${underlying.slice(0, 6)}...${underlying.slice(-4)}`

          return (
            <div key={underlying} className="px-2 py-1">
              <div className="flex items-center gap-1.5 text-[10px] font-medium text-base-content/50 mb-0.5">
                <TokenIcon logoURI={meta?.logoURI} symbol={symbol} size={16} />
                <span>
                  {symbol ?? shortAddr}
                  {symbol && <span className="text-base-content/20 ml-1">{shortAddr}</span>}
                </span>
              </div>
              <div className="flex gap-1">
                {perms.map((perm) => {
                  const key = `${perm.tokenType}:${perm.tokenAddress}`
                  const selected = selectedKeys.has(key)
                  const isCol = perm.tokenType === 'aToken'
                  return (
                    <button key={key} onClick={() => onToggle(key)}
                      className={`btn btn-xs gap-0.5 h-5 min-h-5 ${
                        selected ? (isCol ? 'btn-success btn-outline' : 'btn-warning btn-outline') : 'btn-ghost'
                      }`}>
                      <input type="checkbox" className={`checkbox checkbox-xs ${isCol ? 'checkbox-success' : 'checkbox-warning'}`}
                        checked={selected} readOnly />
                      <span className="text-[10px]">{isCol ? 'aToken' : 'vToken'}</span>
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
