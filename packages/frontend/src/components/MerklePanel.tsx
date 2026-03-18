import { useMemo } from 'react'
import type { Address, Hex } from 'viem'
import type { LenderProtocol } from '../data/lenders'
import { AAVE_POOLS, getAaveTokenPermissions } from '../data/lenders'
import {
  buildAaveLeavesForToken,
  buildMerkleTree,
  protocolToLenderId,
  type GeneratedLeaf,
} from '../lib/merkle'
import type { SelectedTokenPerms } from '../App'

interface Props {
  chainId: number
  selectedLenders: LenderProtocol[]
  selectedTokenPerms: SelectedTokenPerms
}

const OP_COLORS: Record<string, string> = {
  Deposit: 'text-emerald-400 bg-emerald-500/10',
  Borrow: 'text-orange-400 bg-orange-500/10',
  Repay: 'text-blue-400 bg-blue-500/10',
  Withdraw: 'text-purple-400 bg-purple-500/10',
}

export function MerklePanel({ chainId, selectedLenders, selectedTokenPerms }: Props) {
  const { leaves, root, proofs } = useMemo(() => {
    const allLeaves: GeneratedLeaf[] = []
    const cid = String(chainId)

    for (const lender of selectedLenders) {
      if (lender.family !== 'AAVE') continue

      const poolConfig = AAVE_POOLS[lender.id]?.[cid]
      if (!poolConfig) continue

      const selectedKeys = selectedTokenPerms[lender.id]
      if (!selectedKeys || selectedKeys.size === 0) continue

      // Get the token permissions to find underlying -> aToken/vToken mappings
      const tokenPerms = getAaveTokenPermissions(lender.id, chainId)

      // Group by underlying to find which underlyings are selected
      const selectedUnderlyings = new Set<string>()
      for (const perm of tokenPerms) {
        const key = `${perm.tokenType}:${perm.tokenAddress}`
        if (selectedKeys.has(key)) {
          selectedUnderlyings.add(perm.underlying)
        }
      }

      // For each selected underlying, build leaves
      for (const underlying of selectedUnderlyings) {
        const permsForUnderlying = tokenPerms.filter(p => p.underlying === underlying)
        const aTokenPerm = permsForUnderlying.find(p => p.tokenType === 'aToken')
        const vTokenPerm = permsForUnderlying.find(p => p.tokenType === 'vToken')

        const tokenLeaves = buildAaveLeavesForToken({
          protocolId: lender.id,
          underlying: underlying as Address,
          aToken: aTokenPerm?.tokenAddress,
          vToken: vTokenPerm?.tokenAddress,
          pool: poolConfig.pool,
          lenderId: protocolToLenderId(lender.id),
        })
        allLeaves.push(...tokenLeaves)
      }
    }

    if (allLeaves.length === 0) {
      return { leaves: [] as GeneratedLeaf[], root: null as Hex | null, proofs: [] as Hex[][] }
    }

    const leafHashes = allLeaves.map(l => l.leaf)
    const tree = buildMerkleTree(leafHashes)

    return { leaves: allLeaves, root: tree.root, proofs: tree.proofs }
  }, [chainId, selectedLenders, selectedTokenPerms])

  if (leaves.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8 text-center">
        Select Aave tokens to auto-generate merkle leaves
      </div>
    )
  }

  // Group leaves by protocol + underlying for display
  const grouped = new Map<string, GeneratedLeaf[]>()
  for (const leaf of leaves) {
    const key = `${leaf.protocolId}:${leaf.underlying}`
    const arr = grouped.get(key) ?? []
    arr.push(leaf)
    grouped.set(key, arr)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-300">
          Merkle Leaves
          <span className="text-gray-500 text-sm font-normal ml-2">
            ({leaves.length} operations)
          </span>
        </h2>
      </div>

      {/* Merkle Root */}
      {root && (
        <div className="mb-4 px-4 py-3 rounded-lg bg-indigo-500/10 border border-indigo-500/30">
          <div className="text-xs font-semibold text-indigo-400 mb-1">Merkle Root</div>
          <div className="text-xs font-mono text-indigo-300 break-all">{root}</div>
        </div>
      )}

      {/* Leaves grouped by underlying */}
      <div className="space-y-3 max-h-[50vh] overflow-y-auto">
        {Array.from(grouped.entries()).map(([groupKey, groupLeaves]) => {
          const first = groupLeaves[0]
          const shortUnderlying = `${first.underlying.slice(0, 6)}...${first.underlying.slice(-4)}`

          return (
            <div key={groupKey} className="border border-gray-800 rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-gray-900/80 border-b border-gray-800">
                <span className="text-xs font-medium text-gray-400">
                  {first.protocolId.replace(/_/g, ' ')}
                </span>
                <span className="text-xs text-gray-600 ml-2 font-mono">{shortUnderlying}</span>
              </div>
              <div className="divide-y divide-gray-800/50">
                {groupLeaves.map((leaf, i) => (
                  <div key={i} className="px-3 py-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${OP_COLORS[leaf.opName]}`}>
                        {leaf.opName}
                      </span>
                      <span className="text-xs text-gray-500">
                        lender: {leaf.lender}
                      </span>
                    </div>
                    <span className="text-xs font-mono text-gray-600 truncate max-w-[120px]" title={leaf.leaf}>
                      {leaf.leaf.slice(0, 10)}...
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {/* Proof count */}
      <div className="mt-3 text-xs text-gray-600 text-center">
        Tree depth: {proofs[0]?.length ?? 0} | Proofs generated for all {leaves.length} leaves
      </div>
    </div>
  )
}
