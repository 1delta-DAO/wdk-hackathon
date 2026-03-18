import { SUPPORTED_CHAINS } from '../data/chains'

interface Props {
  selectedChainId: number | null
  onSelect: (chainId: number) => void
}

export function ChainSelector({ selectedChainId, onSelect }: Props) {
  return (
    <div>
      <h2 className="text-lg font-semibold mb-3 text-gray-300">Select Chain</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
        {SUPPORTED_CHAINS.map((chain) => (
          <button
            key={chain.id}
            onClick={() => onSelect(chain.id)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border ${
              selectedChainId === chain.id
                ? 'bg-indigo-600 border-indigo-500 text-white'
                : 'bg-gray-900 border-gray-800 text-gray-400 hover:border-gray-600 hover:text-gray-200'
            }`}
          >
            {chain.name}
          </button>
        ))}
      </div>
    </div>
  )
}
