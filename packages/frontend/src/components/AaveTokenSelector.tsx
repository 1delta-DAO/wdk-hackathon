import { useMemo } from 'react'
import { useReadContracts } from 'wagmi'
import { erc20Abi } from 'viem'
import { Crosshair } from 'react-feather'
import type { AaveTokenPermission } from '../data/lenders'
import { useTokenList } from '../hooks/useTokenList'
import type { LenderPositions } from '../hooks/useUserPositions'

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
      className="rounded-full shrink-0 bg-white"
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
  positions?: LenderPositions[]
}

export function tokenPermKey(protocolId: string, perm: AaveTokenPermission): string {
  return `${protocolId}:${perm.tokenType}:${perm.tokenAddress}`
}

export function AaveTokenSelector({ protocolLabel, permissions, selectedKeys, onToggle, onSelectAll, chainId, positions }: Props) {
  const { tokens } = useTokenList(chainId)

  // Derive keys for tokens the user has positions in across ANY lender
  const positionKeys = useMemo(() => {
    if (!positions) return []

    // Collect all underlying addresses with deposits or debt across all lenders
    const depositedUnderlyings = new Set<string>()
    const debtUnderlyings = new Set<string>()
    for (const lp of positions) {
      for (const account of lp.data) {
        for (const pos of account.positions) {
          const underlying = pos.underlyingInfo?.asset?.address?.toLowerCase()
          if (!underlying) continue
          if (pos.depositsUSD > 0.01) depositedUnderlyings.add(underlying)
          if (pos.debtUSD > 0.01) debtUnderlyings.add(underlying)
        }
      }
    }

    const keys: string[] = []
    for (const perm of permissions) {
      const u = perm.underlying.toLowerCase()
      if (perm.tokenType === 'aToken' && depositedUnderlyings.has(u)) {
        keys.push(`${perm.tokenType}:${perm.tokenAddress}`)
      } else if (perm.tokenType === 'vToken' && debtUnderlyings.has(u)) {
        keys.push(`${perm.tokenType}:${perm.tokenAddress}`)
      }
    }
    return keys
  }, [positions, permissions])

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
          {positionKeys.length > 0 && (
            <button onClick={() => onSelectAll(positionKeys)} className="link link-success text-[10px] no-underline">
              Positions
            </button>
          )}
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
                      className={`btn btn-xs gap-0.5 h-5 min-h-5 border-none items-center justify-center ${
                        selected ? (isCol ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning') : 'btn-ghost'
                      }`}>
                      <Crosshair size={10} className={`shrink-0 ${selected ? (isCol ? 'text-success' : 'text-warning') : 'text-base-content/20'}`} />
                      <span className="text-[10px] leading-none">{isCol ? 'aToken' : 'vToken'}</span>
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
