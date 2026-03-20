import type { LenderProtocol } from '../data/lenders'

interface Props {
  lenders: LenderProtocol[]
  selectedLenders: Set<string>
  onToggle: (lenderId: string) => void
}

const FAMILY_BADGE: Record<string, string> = {
  AAVE: 'badge-secondary',
  COMPOUND_V3: 'badge-accent',
  MORPHO_BLUE: 'badge-info',
}

const FAMILY_LABEL: Record<string, string> = {
  AAVE: 'Aave',
  COMPOUND_V3: 'Compound V3',
  MORPHO_BLUE: 'Morpho',
}

export function LenderList({ lenders, selectedLenders, onToggle }: Props) {
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
                <label
                  key={lender.id}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-colors ${
                    selected ? 'bg-primary/10' : 'hover:bg-base-300'
                  }`}
                >
                  <input
                    type="checkbox"
                    className="checkbox checkbox-primary checkbox-xs"
                    checked={selected}
                    onChange={() => onToggle(lender.id)}
                  />
                  <span className="text-xs font-medium flex-1">{lender.label}</span>
                  <span className={`badge badge-xs ${FAMILY_BADGE[lender.family]}`}>
                    {family === 'AAVE' ? 'A' : family === 'COMPOUND_V3' ? 'C3' : 'M'}
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
