import { Crosshair } from 'react-feather'
import type { LenderProtocol } from '../data/lenders'
import type { LenderInfo } from '../hooks/useLendingMeta'

interface Props {
  lenders: LenderProtocol[]
  selectedLenders: Set<string>
  onToggle: (lenderId: string) => void
  lenderMeta?: Record<string, LenderInfo>
}

const FAMILY_LABEL: Record<string, string> = {
  AAVE: 'Aave',
  COMPOUND_V3: 'Compound V3',
  MORPHO_BLUE: 'Morpho',
}

function formatTvl(usd: number): string {
  if (usd >= 1_000_000_000) return `$${(usd / 1_000_000_000).toFixed(1)}B`
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  if (usd >= 1_000) return `$${(usd / 1_000).toFixed(0)}K`
  return `$${usd.toFixed(0)}`
}

export function LenderList({ lenders, selectedLenders, onToggle, lenderMeta }: Props) {
  if (lenders.length === 0) {
    return <div className="text-base-content/40 text-xs py-3 text-center">No lenders on this chain</div>
  }

  const grouped = new Map<string, LenderProtocol[]>()
  for (const l of lenders) {
    const group = grouped.get(l.family) ?? []
    group.push(l)
    grouped.set(l.family, group)
  }

  return (
    <div className="space-y-2">
      {Array.from(grouped.entries()).map(([family, protocols]) => (
        <div key={family}>
          <div className="text-[10px] font-bold text-base-content/30 uppercase tracking-wider mb-1">
            {FAMILY_LABEL[family] ?? family}
          </div>
          <div className="space-y-0.5">
            {protocols.map((lender) => {
              const selected = selectedLenders.has(lender.id)
              return (
                <div
                  key={lender.id}
                  onClick={() => onToggle(lender.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                    selected ? 'bg-primary/10' : 'hover:bg-base-300'
                  }`}
                >
                  <Crosshair size={12} className={selected ? 'text-primary' : 'text-base-content/20'} />
                  {lenderMeta?.[lender.id]?.logoURI && (
                    <img src={lenderMeta[lender.id].logoURI} alt="" className="w-4 h-4 rounded-full shrink-0" />
                  )}
                  <span className="text-xs font-medium flex-1">{lender.label}</span>
                  {lenderMeta?.[lender.id]?.tvlUsd != null && lenderMeta[lender.id].tvlUsd! > 0 && (
                    <span className="text-[10px] text-base-content/30">{formatTvl(lenderMeta[lender.id].tvlUsd!)}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
