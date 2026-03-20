import { SUPPORTED_CHAINS } from '../data/chains'

interface Props {
  selectedChainId: number | null
  onSelect: (chainId: number) => void
}

export function ChainSelector({ selectedChainId, onSelect }: Props) {
  return (
    <div className="flex gap-1">
      {SUPPORTED_CHAINS.map((chain) => (
        <button
          key={chain.id}
          onClick={() => onSelect(chain.id)}
          className={`btn btn-xs ${
            selectedChainId === chain.id ? 'btn-primary' : 'btn-ghost'
          }`}
        >
          {chain.name}
        </button>
      ))}
    </div>
  )
}
