import type { LenderProtocol } from '../data/lenders'

interface Props {
  lenders: LenderProtocol[]
  selectedLenders: Set<string>
  onToggle: (lenderId: string) => void
}

const FAMILY_COLORS: Record<string, string> = {
  AAVE: 'border-purple-500/40 bg-purple-500/5',
  COMPOUND_V3: 'border-green-500/40 bg-green-500/5',
  MORPHO_BLUE: 'border-blue-500/40 bg-blue-500/5',
}

const FAMILY_BADGE: Record<string, string> = {
  AAVE: 'bg-purple-500/20 text-purple-300',
  COMPOUND_V3: 'bg-green-500/20 text-green-300',
  MORPHO_BLUE: 'bg-blue-500/20 text-blue-300',
}

export function LenderList({ lenders, selectedLenders, onToggle }: Props) {
  if (lenders.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8 text-center">
        No supported lenders on this chain
      </div>
    )
  }

  // Group by family
  const grouped = new Map<string, LenderProtocol[]>()
  for (const l of lenders) {
    const group = grouped.get(l.family) ?? []
    group.push(l)
    grouped.set(l.family, group)
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-gray-300">
        Available Lenders
        <span className="text-gray-500 text-sm font-normal ml-2">
          ({lenders.length} protocols)
        </span>
      </h2>
      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([family, protocols]) => (
          <div key={family}>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              {family === 'AAVE' ? 'Aave Forks' : family === 'COMPOUND_V3' ? 'Compound V3 Markets' : 'Morpho'}
            </div>
            <div className="space-y-1.5">
              {protocols.map((lender) => {
                const selected = selectedLenders.has(lender.id)
                return (
                  <button
                    key={lender.id}
                    onClick={() => onToggle(lender.id)}
                    className={`w-full text-left px-4 py-2.5 rounded-lg border transition-all ${
                      selected
                        ? `${FAMILY_COLORS[lender.family]} ring-1 ring-indigo-500/50`
                        : 'border-gray-800 bg-gray-900/50 hover:border-gray-700'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${
                            selected
                              ? 'border-indigo-500 bg-indigo-500'
                              : 'border-gray-600'
                          }`}
                        >
                          {selected && (
                            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>
                        <span className="font-medium text-gray-200 text-sm">{lender.label}</span>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${FAMILY_BADGE[lender.family]}`}>
                        {family === 'AAVE' ? 'Aave' : family === 'COMPOUND_V3' ? 'Compound' : 'Morpho'}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
