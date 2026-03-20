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
import { useTokenList, resolveToken } from '../hooks/useTokenList'
import { useLendingMeta, resolveLender } from '../hooks/useLendingMeta'

interface Props {
  chainId: number
  selectedLenders: LenderProtocol[]
  selectedTokenPerms: SelectedTokenPerms
  morphoMarkets?: MorphoMarketItem[]
  onRootChange?: (root: Hex | null, leaves?: GeneratedLeaf[]) => void
}

const OP_BADGE: Record<string, string> = {
  Deposit: 'badge-success',
  Borrow: 'badge-warning',
  Repay: 'badge-info',
  Withdraw: 'badge-secondary',
}

export function MerklePanel({ chainId, selectedLenders, selectedTokenPerms, morphoMarkets, onRootChange }: Props) {
  const { tokens } = useTokenList(chainId)
  const { lenders } = useLendingMeta(chainId)

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
      <div className="text-base-content/40 text-sm py-8 text-center">
        Select tokens or markets to generate merkle leaves
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
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-bold">Merkle Leaves</h2>
          <p className="text-xs text-base-content/40">{leaves.length} operations</p>
        </div>
      </div>

      {/* Merkle Root */}
      {root && (
        <div className="alert alert-info mb-3 py-2">
          <div>
            <div className="text-xs font-semibold mb-0.5">Merkle Root</div>
            <div className="text-xs font-mono break-all opacity-80">{root}</div>
          </div>
        </div>
      )}

      {/* Leaves grouped by underlying */}
      <div className="space-y-2 max-h-[50vh] overflow-y-auto">
        {Array.from(grouped.entries()).map(([groupKey, groupLeaves]) => {
          const first = groupLeaves[0]
          const lenderInfo = resolveLender(lenders, first.protocolId)
          const assetInfo = resolveToken(tokens, first.underlying)

          return (
            <div key={groupKey} className="card card-compact bg-base-200 border border-base-300">
              <div className="card-body p-0">
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-base-300">
                  {lenderInfo.logoURI && (
                    <img src={lenderInfo.logoURI} alt={lenderInfo.name} className="w-4 h-4 rounded-full" />
                  )}
                  <span className="text-xs font-semibold">{lenderInfo.name}</span>
                  <span className="text-base-content/20">|</span>
                  {assetInfo.logoURI && (
                    <img src={assetInfo.logoURI} alt={assetInfo.symbol} className="w-4 h-4 rounded-full" />
                  )}
                  <span className="text-xs font-medium text-base-content/60">{assetInfo.symbol}</span>
                  <span className="text-xs text-base-content/30 font-mono ml-auto" title={first.underlying}>
                    {first.underlying.slice(0, 6)}...{first.underlying.slice(-4)}
                  </span>
                </div>
                <div className="divide-y divide-base-300">
                  {groupLeaves.map((leaf, i) => (
                    <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`badge badge-xs ${OP_BADGE[leaf.opName]}`}>
                          {leaf.opName}
                        </span>
                        <span className="text-xs text-base-content/40">
                          {resolveLender(lenders, leaf.protocolId).name}
                        </span>
                      </div>
                      <span className="text-[10px] font-mono text-base-content/30 truncate max-w-[100px]" title={leaf.leaf}>
                        {leaf.leaf.slice(0, 10)}...
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-center text-xs text-base-content/30 mt-2">
        Depth: {proofs[0]?.length ?? 0} | {leaves.length} leaves
      </div>
    </div>
  )
}
