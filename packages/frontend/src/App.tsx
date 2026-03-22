import { useState, useMemo, useCallback } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import type { Address, Hex } from 'viem'
import { parseUnits } from 'viem'
import { Check, Search, X } from 'react-feather'
import { ChainSelector } from './components/ChainSelector'
import { LenderList } from './components/LenderList'
import { AaveTokenSelector } from './components/AaveTokenSelector'
import { PermissionPanel, buildPermissionRows } from './components/PermissionPanel'
import { MerklePanel } from './components/MerklePanel'
import { ConnectButton } from './components/ConnectButton'
import { ThemeSelector } from './components/ThemeSelector'
import { UserPositions } from './components/UserPositions'
import { useUserPositions } from './hooks/useUserPositions'
import {
  getLendersForChain,
  getAaveTokenPermissions,
  AAVE_POOLS,
  COMPOUND_V3_POOLS,
  MORPHO_BLUE_ADDRESSES,
} from './data/lenders'
import { usePermitSignatures } from './hooks/usePermitSignatures'
import { useOrderSubmission } from './hooks/useOrderSubmission'
import { useMorphoMarkets } from './hooks/useMorphoMarkets'
import { useLendingMeta } from './hooks/useLendingMeta'
import { protocolToLenderId, type GeneratedLeaf } from './lib/merkle'
import { SETTLEMENT_ADDRESSES } from './config/settlements'
import {
  encodeSettlementData,
  encodeOrderData,
  type Condition,
} from '@1delta/settlement-sdk'

export type SelectedTokenPerms = Record<string, Set<string>>
type HfMode = 'all' | 'per_lender'

/** Reusable tile wrapper */
function Tile({ title, sub, children, className = '' }: {
  title: string
  sub?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={`bg-base-200 rounded-lg border border-base-300 overflow-hidden ${className}`}>
      <div className="px-3 py-2 border-b border-base-300 flex items-baseline gap-2">
        <h3 className="text-sm font-bold">{title}</h3>
        {sub && <span className="text-[11px] text-base-content/40">{sub}</span>}
      </div>
      <div className="p-2.5">{children}</div>
    </div>
  )
}

export default function App() {
  const { isConnected, address } = useAccount()
  const connectedChainId = useChainId()
  const { switchChain } = useSwitchChain()

  const [selectedChainId, setSelectedChainId] = useState<number | null>(null)
  const [observeAddress, setObserveAddress] = useState<string>('')
  const [selectedLenderIds, setSelectedLenderIds] = useState<Set<string>>(new Set())
  const [selectedTokenPerms, setSelectedTokenPerms] = useState<SelectedTokenPerms>({})
  const [minHealthFactor, setMinHealthFactor] = useState<string>('')
  const [hfMode, setHfMode] = useState<HfMode>('all')
  const [perLenderHealthFactor, setPerLenderHealthFactor] = useState<Record<string, string>>({})
  const [merkleRoot, setMerkleRoot] = useState<Hex | null>(null)
  const [allLeaves, setAllLeaves] = useState<GeneratedLeaf[]>([])

  const activeChainId = selectedChainId ?? connectedChainId
  const chainMismatch = isConnected && activeChainId != null && connectedChainId !== activeChainId
  const settlementAddress = activeChainId ? (SETTLEMENT_ADDRESSES[activeChainId] ?? '0x0000000000000000000000000000000000000001' as Address) : '0x0000000000000000000000000000000000000001' as Address

  const lenders = useMemo(
    () => (activeChainId ? getLendersForChain(activeChainId) : []),
    [activeChainId],
  )

  const { markets: morphoMarkets, loading: morphoLoading, error: morphoError } = useMorphoMarkets(activeChainId)
  const { lenders: lenderMeta } = useLendingMeta(activeChainId)

  const effectiveAccount = observeAddress.match(/^0x[0-9a-fA-F]{40}$/) ? observeAddress : address
  const { positions, loading: positionsLoading, error: positionsError } = useUserPositions(effectiveAccount, activeChainId)

  const selectedLenders = useMemo(
    () => lenders.filter((l) => selectedLenderIds.has(l.id)),
    [lenders, selectedLenderIds],
  )

  const aaveLenders = useMemo(
    () => selectedLenders.filter(l => l.family === 'AAVE'),
    [selectedLenders],
  )

  const lendersForSafety = useMemo(
    () => selectedLenders.filter((l) => l.family === 'AAVE' || l.family === 'COMPOUND_V3' || l.family === 'MORPHO_BLUE'),
    [selectedLenders],
  )

  const handleRootChange = useCallback((root: Hex | null, leaves?: GeneratedLeaf[]) => {
    setMerkleRoot(root)
    setAllLeaves(leaves ?? [])
  }, [])

  const { orderData, settlementData: encodedSettlementData, conditionCount } = useMemo(() => {
    if (!merkleRoot || !activeChainId) return { orderData: null as Hex | null, settlementData: '0x' as Hex, conditionCount: 0 }

    const conditions: Condition[] = []
    const getHfForLender = (lenderId: string): bigint | null => {
      const raw = hfMode === 'all' ? minHealthFactor : (perLenderHealthFactor[lenderId] ?? '')
      const num = raw.trim() ? parseFloat(raw) : 0
      if (num < 1.0) return null
      return parseUnits(raw.trim(), 18)
    }

    {
      const cid = String(activeChainId)
      for (const lender of selectedLenders) {
        const hf = getHfForLender(lender.id)
        if (hf === null) continue
        if (lender.family === 'AAVE') {
          const poolConfig = AAVE_POOLS[lender.id]?.[cid]
          const selectedKeys = selectedTokenPerms[lender.id]
          if (poolConfig && selectedKeys && selectedKeys.size > 0) {
            conditions.push({ lenderId: protocolToLenderId(lender.id), pool: poolConfig.pool, minHealthFactor: hf })
          }
        } else if (lender.family === 'COMPOUND_V3') {
          const comet = COMPOUND_V3_POOLS[cid]?.[lender.id]
          if (comet) {
            conditions.push({ lenderId: protocolToLenderId(lender.id), comet, assetBitmap: 0xFFFF, minHealthFactor: hf })
          }
        } else if (lender.family === 'MORPHO_BLUE') {
          const morpho = MORPHO_BLUE_ADDRESSES[cid]
          if (morpho && morphoMarkets.length > 0) {
            for (const item of morphoMarkets) {
              const raw = item.params.market.id
              const mid = raw && !raw.startsWith('0x') ? `0x${raw}` : raw
              if (mid && mid.length === 66) {
                conditions.push({ lenderId: protocolToLenderId(lender.id), morpho, marketId: mid as Hex, minHealthFactor: hf })
              }
            }
          }
        }
      }
    }

    const settlementData = conditions.length > 0 ? encodeSettlementData([], conditions) : ('0x' as Hex)
    const orderData = encodeOrderData(merkleRoot, settlementData)
    return { orderData, settlementData, conditionCount: conditions.length }
  }, [merkleRoot, activeChainId, hfMode, minHealthFactor, perLenderHealthFactor, selectedLenders, selectedTokenPerms, morphoMarkets])

  const handleCopyOrderData = useCallback(() => {
    if (orderData) void navigator.clipboard.writeText(orderData)
  }, [orderData])

  const { signPermission, signedPermissions, signing, error, clearSignatures } = usePermitSignatures(settlementAddress, activeChainId ?? undefined)

  const {
    submitOrder,
    submitting: orderSubmitting,
    submitted: orderSubmitted,
    error: orderError,
    settlementAddress: deployedSettlement,
  } = useOrderSubmission(activeChainId)

  const handleSubmitOrder = useCallback(() => {
    if (!merkleRoot || !orderData) return
    submitOrder({ merkleRoot, settlementData: encodedSettlementData, orderData, leaves: allLeaves, permits: signedPermissions, maxFeeBps: 100_000 })
  }, [merkleRoot, orderData, encodedSettlementData, allLeaves, submitOrder, signedPermissions])

  const handleChainSelect = useCallback(
    (chainId: number) => {
      setSelectedChainId(chainId)
      setSelectedLenderIds(new Set())
      setSelectedTokenPerms({})
      setPerLenderHealthFactor({})
      clearSignatures()
      if (isConnected && chainId !== connectedChainId) switchChain({ chainId })
    },
    [isConnected, connectedChainId, switchChain, clearSignatures],
  )

  const handleToggleLender = useCallback((lenderId: string) => {
    setSelectedLenderIds((prev) => {
      const next = new Set(prev)
      if (next.has(lenderId)) {
        next.delete(lenderId)
        setSelectedTokenPerms(p => { const c = { ...p }; delete c[lenderId]; return c })
        setPerLenderHealthFactor(p => { const c = { ...p }; delete c[lenderId]; return c })
      } else {
        next.add(lenderId)
      }
      return next
    })
  }, [])

  const handleToggleTokenPerm = useCallback((protocolId: string, key: string) => {
    setSelectedTokenPerms(prev => {
      const current = prev[protocolId] ?? new Set<string>()
      const next = new Set(current)
      if (next.has(key)) next.delete(key); else next.add(key)
      return { ...prev, [protocolId]: next }
    })
  }, [])

  const handleSelectAllTokenPerms = useCallback((protocolId: string, keys: string[]) => {
    setSelectedTokenPerms(prev => {
      const current = prev[protocolId] ?? new Set<string>()
      const allSelected = keys.every(k => current.has(k))
      return { ...prev, [protocolId]: allSelected ? new Set<string>() : new Set(keys) }
    })
  }, [])

  const handleSignAll = useCallback(() => {
    if (!activeChainId) return
    const rows = buildPermissionRows(activeChainId, selectedLenders, selectedTokenPerms)
    for (const row of rows) {
      if (!signedPermissions.some(s => s.request.label === row.key)) {
        signPermission({ kind: row.kind, label: row.key, targetAddress: row.targetAddress, chainId: row.chainId })
      }
    }
  }, [activeChainId, selectedLenders, selectedTokenPerms, signedPermissions, signPermission])

  const hasLenderSelection = selectedLenders.length > 0
  const showHfSection = activeChainId && selectedLenders.some(l => l.family === 'AAVE' || l.family === 'COMPOUND_V3' || l.family === 'MORPHO_BLUE')

  return (
    <div className="min-h-screen flex flex-col bg-base-100">
      {/* Navbar */}
      <nav className="navbar bg-base-200 border-b border-base-300 px-3 min-h-0 h-11">
        <div className="navbar-start">
          <h1 className="text-sm font-bold">1delta Agents Gateway</h1>
        </div>
        <div className="navbar-center">
          <ChainSelector selectedChainId={activeChainId} onSelect={handleChainSelect} />
        </div>
        <div className="navbar-end gap-2">
          <ThemeSelector />
          <ConnectButton />
        </div>
      </nav>

      {chainMismatch && (
        <div className="alert alert-warning rounded-none py-1.5 px-3 text-xs flex items-center justify-between">
          <span>Wallet is on a different chain. Switch to continue.</span>
          <button className="btn btn-xs btn-warning" onClick={() => switchChain({ chainId: activeChainId! })}>
            Switch wallet
          </button>
        </div>
      )}

      <main className="flex-1 p-3">
        <div className="max-w-7xl mx-auto space-y-3">

          {/* Row 1: Positions */}
          {activeChainId && (
            <Tile
              title={observeAddress.match(/^0x[0-9a-fA-F]{40}$/)
                ? `Positions (${observeAddress.slice(0, 6)}...${observeAddress.slice(-4)})`
                : 'Positions'}
              sub={effectiveAccount ? `${effectiveAccount.slice(0, 6)}...${effectiveAccount.slice(-4)}` : undefined}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <Search size={12} className="text-base-content/30 shrink-0" />
                <input
                  type="text"
                  placeholder="Observe any address..."
                  value={observeAddress}
                  onChange={(e) => setObserveAddress(e.target.value.trim())}
                  className={`input input-bordered input-xs flex-1 max-w-64 font-mono text-[11px] ${
                    observeAddress && !observeAddress.match(/^0x[0-9a-fA-F]{40}$/)
                      ? 'input-error' : observeAddress ? 'input-info' : ''
                  }`}
                />
                {observeAddress && (
                  <button className="btn btn-ghost btn-xs btn-square" onClick={() => setObserveAddress('')}>
                    <X size={12} />
                  </button>
                )}
              </div>
              {effectiveAccount ? (
                <UserPositions positions={positions} loading={positionsLoading} error={positionsError} lenderMeta={lenderMeta} />
              ) : (
                <div className="text-base-content/40 text-xs py-3 text-center">
                  Connect wallet or paste an address
                </div>
              )}
            </Tile>
          )}

          {/* Row 2: Lenders + Tokens + Permissions (tile grid) */}
          {activeChainId && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {/* Lenders tile */}
              <Tile title="Lenders" sub={`${lenders.length} available`}>
                <LenderList
                  lenders={lenders}
                  selectedLenders={selectedLenderIds}
                  onToggle={handleToggleLender}
                  lenderMeta={lenderMeta}
                />
              </Tile>

              {/* Tokens tile */}
              <Tile title="Tokens" sub={hasLenderSelection ? `${selectedLenders.length} selected` : undefined}>
                {hasLenderSelection ? (
                  <div className="space-y-1.5">
                    {aaveLenders.map(lender => {
                      const perms = getAaveTokenPermissions(lender.id, activeChainId)
                      return (
                        <AaveTokenSelector
                          key={lender.id}
                          protocolLabel={lender.label}
                          permissions={perms}
                          selectedKeys={selectedTokenPerms[lender.id] ?? new Set()}
                          onToggle={(key) => handleToggleTokenPerm(lender.id, key)}
                          onSelectAll={(keys) => handleSelectAllTokenPerms(lender.id, keys)}
                          chainId={activeChainId}
                        />
                      )
                    })}

                    {selectedLenders.some(l => l.family === 'MORPHO_BLUE') && (
                      <div className="flex items-center justify-between px-2 py-1.5 bg-base-300/50 rounded">
                        <span className="text-xs font-semibold text-info">Morpho Blue</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-base-content/40">
                            {morphoLoading ? <span className="loading loading-dots loading-xs" />
                              : morphoError ? <span className="text-error text-[10px]">err</span>
                              : `${morphoMarkets.length} mkts`}
                          </span>
                          <span className="badge badge-success badge-xs gap-0.5">
                            <Check size={8} /> all
                          </span>
                        </div>
                      </div>
                    )}

                    {selectedLenders.filter(l => l.family === 'COMPOUND_V3').map(lender => (
                      <div key={lender.id} className="flex items-center justify-between px-2 py-1.5 bg-base-300/50 rounded">
                        <span className="text-xs font-semibold text-accent">{lender.label}</span>
                        <span className="badge badge-success badge-xs gap-0.5">
                          <Check size={8} /> all
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-base-content/40 text-xs py-3 text-center">Select lenders first</div>
                )}
              </Tile>

              {/* Permissions tile */}
              <Tile title="Permissions">
                <PermissionPanel
                  chainId={activeChainId}
                  selectedLenders={selectedLenders}
                  selectedTokenPerms={selectedTokenPerms}
                  signedPermissions={signedPermissions}
                  signing={signing}
                  error={error}
                  onSign={signPermission}
                  onSignAll={handleSignAll}
                  settlementAddress={settlementAddress}
                />
              </Tile>
            </div>
          )}

          {/* Row 3: Health Factor + Merkle + Order (tile grid) */}
          {showHfSection && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              {/* HF tile */}
              <Tile title="Liquidation Preventer" sub="min health factor">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                  <label className="label cursor-pointer gap-1.5 p-0">
                    <input type="radio" name="hf-mode" className="radio radio-primary radio-xs"
                      checked={hfMode === 'all'} onChange={() => setHfMode('all')} />
                    <span className="text-xs">All</span>
                  </label>
                  <label className="label cursor-pointer gap-1.5 p-0">
                    <input type="radio" name="hf-mode" className="radio radio-primary radio-xs"
                      checked={hfMode === 'per_lender'} onChange={() => setHfMode('per_lender')} />
                    <span className="text-xs">Per lender</span>
                  </label>
                </div>

                {hfMode === 'all' ? (
                  <input type="number" min="1" step="0.05" placeholder="e.g. 1.2"
                    value={minHealthFactor} onChange={(e) => setMinHealthFactor(e.target.value)}
                    className="input input-bordered input-xs w-full max-w-xs" />
                ) : (
                  <div className="space-y-1">
                    {lendersForSafety.length === 0 ? (
                      <div className="text-xs text-base-content/40">Select lenders first.</div>
                    ) : lendersForSafety.map((lender) => {
                      const raw = perLenderHealthFactor[lender.id] ?? ''
                      const num = raw.trim() ? parseFloat(raw) : 0
                      const cid = String(activeChainId)
                      const willApply = num >= 1.0 && (
                        lender.family === 'COMPOUND_V3' ? Boolean(COMPOUND_V3_POOLS[cid]?.[lender.id])
                        : lender.family === 'AAVE' ? Boolean(AAVE_POOLS[lender.id]?.[cid]) && Boolean(selectedTokenPerms[lender.id]?.size)
                        : lender.family === 'MORPHO_BLUE' ? Boolean(MORPHO_BLUE_ADDRESSES[cid]) && morphoMarkets.length > 0
                        : false)

                      return (
                        <div key={lender.id} className="flex items-center gap-2">
                          <span className="text-xs min-w-28 flex items-center gap-1">
                            {lender.label}
                            <span className={`badge badge-xs ${willApply ? 'badge-success' : 'badge-ghost'}`}>
                              {willApply ? 'on' : 'off'}
                            </span>
                          </span>
                          <input type="number" min="1" step="0.05" placeholder="1.2"
                            value={perLenderHealthFactor[lender.id] ?? ''}
                            onChange={(e) => setPerLenderHealthFactor(p => ({ ...p, [lender.id]: e.target.value }))}
                            className="input input-bordered input-xs flex-1 max-w-32" />
                        </div>
                      )
                    })}
                  </div>
                )}
              </Tile>

              {/* Merkle tile */}
              <Tile title="Merkle Tree">
                <MerklePanel
                  chainId={activeChainId!}
                  selectedLenders={selectedLenders}
                  selectedTokenPerms={selectedTokenPerms}
                  morphoMarkets={morphoMarkets}
                  onRootChange={handleRootChange}
                />
              </Tile>
            </div>
          )}

          {/* Row 4: Order data */}
          {orderData && (
            <Tile title="Order Data" sub={
              (conditionCount > 0
                ? (hfMode === 'all' ? `${conditionCount} cond, HF ${minHealthFactor || '--'}` : `${conditionCount} cond, per-lender`)
                : 'no conditions')
              + (deployedSettlement ? ` | ${deployedSettlement.slice(0, 6)}...${deployedSettlement.slice(-4)}` : ' | no settlement')
            }>
              <div className="flex items-start gap-2">
                <pre className="flex-1 text-[11px] font-mono break-all overflow-x-auto max-h-16 overflow-y-auto bg-base-300 rounded p-1.5 text-base-content/60">
                  {orderData}
                </pre>
                <div className="shrink-0 flex flex-col gap-1">
                  <button onClick={handleCopyOrderData} className="btn btn-xs btn-outline btn-warning">Copy</button>
                  <button onClick={handleSubmitOrder}
                    disabled={orderSubmitting || !deployedSettlement || !isConnected}
                    className="btn btn-xs btn-primary">
                    {orderSubmitting ? <span className="loading loading-spinner loading-xs" /> : 'Submit'}
                  </button>
                </div>
              </div>
              {orderSubmitted && (
                <div className="alert alert-success py-1 mt-1.5 text-xs">Order submitted! ID: {orderSubmitted.id}</div>
              )}
              {orderError && (
                <div className="alert alert-error py-1 mt-1.5 text-xs">{orderError}</div>
              )}
            </Tile>
          )}
        </div>
      </main>

      <footer className="border-t border-base-300 px-3 py-2 text-center text-[11px] text-base-content/30">
        1delta Agents Gateway
      </footer>
    </div>
  )
}
