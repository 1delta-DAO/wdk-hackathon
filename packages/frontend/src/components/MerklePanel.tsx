import { useEffect, useMemo } from 'react'
import type { Address, Hex } from 'viem'
import type { LenderProtocol } from '../data/lenders'
import { AAVE_POOLS, COMPOUND_V3_POOLS, MORPHO_BLUE_ADDRESSES, getAaveTokenPermissions } from '../data/lenders'
import {
  buildAaveLeavesForToken,
  buildCompoundV3LeavesForComet,
  buildMorphoLeavesForMarket,
  buildMerkleTree,
  protocolToLenderId,
  LENDER_ID_MORPHO,
  type GeneratedLeaf,
  type MorphoMarketParams,
} from '../lib/merkle'
import type { SelectedTokenPerms } from '../App'
import type { MorphoMarketItem } from '../hooks/useMorphoMarkets'

interface Props {
  chainId: number
  selectedLenders: LenderProtocol[]
  selectedTokenPerms: SelectedTokenPerms
  morphoMarkets?: MorphoMarketItem[]
  onRootChange?: (root: Hex | null, leaves?: GeneratedLeaf[]) => void
}

const OP_COLORS: Record<string, string> = {
  Deposit: 'text-emerald-400 bg-emerald-500/10',
  Borrow: 'text-orange-400 bg-orange-500/10',
  Repay: 'text-blue-400 bg-blue-500/10',
  Withdraw: 'text-purple-400 bg-purple-500/10',
}

export function MerklePanel({ chainId, selectedLenders, selectedTokenPerms, morphoMarkets, onRootChange }: Props) {
  const { leaves, root, proofs } = useMemo(() => {
    const allLeaves: GeneratedLeaf[] = []
    const cid = String(chainId)

    for (const lender of selectedLenders) {
      if (lender.family === 'AAVE') {
        const poolConfig = AAVE_POOLS[lender.id]?.[cid]
        if (!poolConfig) continue

        const selectedKeys = selectedTokenPerms[lender.id]
        if (!selectedKeys || selectedKeys.size === 0) continue

        const tokenPerms = getAaveTokenPermissions(lender.id, chainId)
        const selectedUnderlyings = new Set<string>()
        for (const perm of tokenPerms) {
          const key = `${perm.tokenType}:${perm.tokenAddress}`
          if (selectedKeys.has(key)) {
            selectedUnderlyings.add(perm.underlying)
          }
        }

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
      } else if (lender.family === 'COMPOUND_V3') {
        const comet = COMPOUND_V3_POOLS[cid]?.[lender.id]
        if (!comet) continue

        const c3Leaves = buildCompoundV3LeavesForComet({
          protocolId: lender.id,
          comet,
          lenderId: protocolToLenderId(lender.id),
        })
        allLeaves.push(...c3Leaves)
      } else if (lender.family === 'MORPHO_BLUE' && morphoMarkets && morphoMarkets.length > 0) {
        const morpho = MORPHO_BLUE_ADDRESSES[cid]
        if (!morpho) continue

        for (const item of morphoMarkets) {
          const mp = item.params.market
          const market: MorphoMarketParams = {
            loanToken: mp.loanAddress as Address,
            collateralToken: mp.collateralAddress as Address,
            oracle: mp.oracle as Address,
            irm: mp.irm as Address,
            lltv: BigInt(mp.lltv),
          }
          const morphoLeaves = buildMorphoLeavesForMarket({
            protocolId: item.lenderKey,
            market,
            morpho,
            lenderId: LENDER_ID_MORPHO,
          })
          allLeaves.push(...morphoLeaves)
        }
      }
    }

    if (allLeaves.length === 0) {
      return { leaves: [] as GeneratedLeaf[], root: null as Hex | null, proofs: [] as Hex[][] }
    }

    const leafHashes = allLeaves.map(l => l.leaf)
    const tree = buildMerkleTree(leafHashes)

    return { leaves: allLeaves, root: tree.root, proofs: tree.proofs }
  }, [chainId, selectedLenders, selectedTokenPerms, morphoMarkets])

  useEffect(() => {
    onRootChange?.(root ?? null, leaves.length > 0 ? leaves : undefined)
  }, [root, leaves, onRootChange])

  if (leaves.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8 text-center">
        Select Aave tokens, Compound V3 markets, or Morpho markets to auto-generate merkle leaves
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
