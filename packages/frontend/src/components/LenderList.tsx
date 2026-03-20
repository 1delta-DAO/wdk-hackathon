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
  AAVE: 'Aave Forks',
  COMPOUND_V3: 'Compound V3',
  MORPHO_BLUE: 'Morpho',
}

export function LenderList({ lenders, selectedLenders, onToggle }: Props) {
  if (lenders.length === 0) {
    return (
      <div className="text-base-content/50 text-sm py-8 text-center">
        No supported lenders on this chain
      </div>
    )
  }

  const grouped = new Map<string, LenderProtocol[]>()
  for (const l of lenders) {
    const group = grouped.get(l.family) ?? []
    group.push(l)
    grouped.set(l.family, group)
  }

  return (
    <div>
      <h2 className="text-lg font-bold mb-1">Lenders</h2>
      <p className="text-xs text-base-content/50 mb-3">{lenders.length} protocols available</p>
      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([family, protocols]) => (
          <div key={family}>
            <div className="text-xs font-semibold text-base-content/40 uppercase tracking-wider mb-1.5">
              {FAMILY_LABEL[family] ?? family}
            </div>
            <div className="space-y-1">
              {protocols.map((lender) => {
                const selected = selectedLenders.has(lender.id)
                return (
                  <label
                    key={lender.id}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-colors ${
                      selected ? 'bg-primary/10' : 'hover:bg-base-200'
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="checkbox checkbox-primary checkbox-xs"
                      checked={selected}
                      onChange={() => onToggle(lender.id)}
                    />
                    <span className="text-sm font-medium flex-1">{lender.label}</span>
                    <span className={`badge badge-xs ${FAMILY_BADGE[lender.family]}`}>
                      {family === 'AAVE' ? 'Aave' : family === 'COMPOUND_V3' ? 'C3' : 'Morpho'}
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
