import { useEffect, useMemo } from 'react'
import type { Address, Hex } from 'viem'
import type { LenderProtocol } from '../data/lenders'
import { AAVE_POOLS, COMPOUND_V3_POOLS, MORPHO_BLUE_ADDRESSES, getAaveTokenPermissions } from '../data/lenders'
import {
  buildAaveLeavesForToken, buildCompoundV3LeavesForComet, buildMorphoLeavesForMarket,
  buildMerkleTree, protocolToLenderId, LENDER_ID_MORPHO,
  type GeneratedLeaf, type MorphoMarketParams,
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
  Deposit: 'badge-success', Borrow: 'badge-warning', Repay: 'badge-info', Withdraw: 'badge-secondary',
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
          if (selectedKeys.has(`${perm.tokenType}:${perm.tokenAddress}`)) selectedUnderlyings.add(perm.underlying)
        }
        for (const underlying of selectedUnderlyings) {
          const permsForUnderlying = tokenPerms.filter(p => p.underlying === underlying)
          allLeaves.push(...buildAaveLeavesForToken({
            protocolId: lender.id, underlying: underlying as Address,
            aToken: permsForUnderlying.find(p => p.tokenType === 'aToken')?.tokenAddress,
            vToken: permsForUnderlying.find(p => p.tokenType === 'vToken')?.tokenAddress,
            pool: poolConfig.pool, lenderId: protocolToLenderId(lender.id),
          }))
        }
      } else if (lender.family === 'COMPOUND_V3') {
        const comet = COMPOUND_V3_POOLS[cid]?.[lender.id]
        if (comet) allLeaves.push(...buildCompoundV3LeavesForComet({ protocolId: lender.id, comet, lenderId: protocolToLenderId(lender.id) }))
      } else if (lender.family === 'MORPHO_BLUE' && morphoMarkets && morphoMarkets.length > 0) {
        const morpho = MORPHO_BLUE_ADDRESSES[cid]
        if (!morpho) continue
        for (const item of morphoMarkets) {
          const mp = item.params.market
          const market: MorphoMarketParams = {
            loanToken: mp.loanAddress as Address, collateralToken: mp.collateralAddress as Address,
            oracle: mp.oracle as Address, irm: mp.irm as Address, lltv: BigInt(mp.lltv),
          }
          allLeaves.push(...buildMorphoLeavesForMarket({ protocolId: item.lenderKey, market, morpho, lenderId: LENDER_ID_MORPHO }))
        }
      }
    }

    // Deduplicate leaves by their hash (same op+lender+data = same leaf)
    const seen = new Set<Hex>()
    const uniqueLeaves: GeneratedLeaf[] = []
    for (const leaf of allLeaves) {
      if (!seen.has(leaf.leaf)) {
        seen.add(leaf.leaf)
        uniqueLeaves.push(leaf)
      }
    }

    if (uniqueLeaves.length === 0) return { leaves: [] as GeneratedLeaf[], root: null as Hex | null, proofs: [] as Hex[][] }
    const tree = buildMerkleTree(uniqueLeaves.map(l => l.leaf))
    return { leaves: uniqueLeaves, root: tree.root, proofs: tree.proofs }
  }, [chainId, selectedLenders, selectedTokenPerms, morphoMarkets])

  useEffect(() => { onRootChange?.(root ?? null, leaves.length > 0 ? leaves : undefined) }, [root, leaves, onRootChange])

  if (leaves.length === 0) {
    return <div className="text-base-content/40 text-xs py-3 text-center">Select tokens to generate leaves</div>
  }

  const grouped = new Map<string, GeneratedLeaf[]>()
  for (const leaf of leaves) {
    const key = `${leaf.protocolId}:${leaf.underlying}`
    const arr = grouped.get(key) ?? []
    arr.push(leaf)
    grouped.set(key, arr)
  }

  return (
    <div>
      {/* Root */}
      {root && (
        <div className="bg-info/10 border border-info/20 rounded px-2 py-1.5 mb-2">
          <div className="text-[10px] font-bold text-info mb-0.5">Root</div>
          <div className="text-[10px] font-mono break-all text-info/70">{root}</div>
        </div>
      )}

      {/* Leaves */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {Array.from(grouped.entries()).map(([groupKey, groupLeaves]) => {
          const first = groupLeaves[0]
          const lenderInfo = resolveLender(lenders, first.protocolId)
          const assetInfo = resolveToken(tokens, first.underlying)

          return (
            <div key={groupKey} className="bg-base-300/50 rounded border border-base-300 overflow-hidden">
              <div className="flex items-center gap-1.5 px-2 py-1 border-b border-base-300/40">
                {lenderInfo.logoURI && <img src={lenderInfo.logoURI} alt="" className="w-3 h-3 rounded-full" />}
                <span className="text-[10px] font-bold">{lenderInfo.name}</span>
                <span className="text-base-content/15 text-[10px]">|</span>
                {assetInfo.logoURI && <img src={assetInfo.logoURI} alt="" className="w-3 h-3 rounded-full" />}
                <span className="text-[10px] text-base-content/50">{assetInfo.symbol}</span>
              </div>
              <div className="divide-y divide-base-300/20">
                {groupLeaves.map((leaf, i) => (
                  <div key={i} className="flex items-center justify-between px-2 py-0.5">
                    <span className={`badge badge-xs ${OP_BADGE[leaf.opName]}`}>{leaf.opName}</span>
                    <span className="text-[9px] font-mono text-base-content/20 truncate max-w-20">{leaf.leaf.slice(0, 10)}...</span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="text-center text-[10px] text-base-content/20 mt-1.5">
        {leaves.length} leaves | depth {proofs[0]?.length ?? 0}
      </div>
    </div>
  )
}
