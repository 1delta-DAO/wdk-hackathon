import { SUPPORTED_CHAINS } from '../data/chains'

interface Props {
  selectedChainId: number | null
  onSelect: (chainId: number) => void
}

export function ChainSelector({ selectedChainId, onSelect }: Props) {
  return (
    <div>
      <h2 className="text-lg font-bold mb-2">Select Chain</h2>
      <div className="flex flex-wrap gap-2">
        {SUPPORTED_CHAINS.map((chain) => (
          <button
            key={chain.id}
            onClick={() => onSelect(chain.id)}
            className={`btn btn-sm ${
              selectedChainId === chain.id ? 'btn-primary' : 'btn-ghost'
            }`}
          >
            {chain.name}
          </button>
        ))}
      </div>
    </div>
  )
}
