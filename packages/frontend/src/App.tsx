import { useState, useMemo, useCallback } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import type { Address, Hex } from 'viem'
import { parseUnits } from 'viem'
import { ChainSelector } from './components/ChainSelector'
import { LenderList } from './components/LenderList'
import { AaveTokenSelector } from './components/AaveTokenSelector'
import { PermissionPanel, buildPermissionRows } from './components/PermissionPanel'
import { MerklePanel } from './components/MerklePanel'
import { ConnectButton } from './components/ConnectButton'
import { ThemeSelector } from './components/ThemeSelector'
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
import { protocolToLenderId, type GeneratedLeaf } from './lib/merkle'
import { SETTLEMENT_ADDRESSES } from './config/settlements'
import {
  encodeSettlementData,
  encodeOrderData,
  type Condition,
} from '@1delta/settlement-sdk'

/** Map of protocolId -> Set of "tokenType:tokenAddress" keys */
export type SelectedTokenPerms = Record<string, Set<string>>
type HfMode = 'all' | 'per_lender'

export default function App() {
  const { isConnected } = useAccount()
  const connectedChainId = useChainId()
  const { switchChain } = useSwitchChain()

  const [selectedChainId, setSelectedChainId] = useState<number | null>(null)
  const [selectedLenderIds, setSelectedLenderIds] = useState<Set<string>>(new Set())
  const [selectedTokenPerms, setSelectedTokenPerms] = useState<SelectedTokenPerms>({})
  const [minHealthFactor, setMinHealthFactor] = useState<string>('')
  const [hfMode, setHfMode] = useState<HfMode>('all')
  const [perLenderHealthFactor, setPerLenderHealthFactor] = useState<Record<string, string>>({})
  const [merkleRoot, setMerkleRoot] = useState<Hex | null>(null)
  const [allLeaves, setAllLeaves] = useState<GeneratedLeaf[]>([])

  const activeChainId = selectedChainId ?? connectedChainId
  const settlementAddress = activeChainId ? (SETTLEMENT_ADDRESSES[activeChainId] ?? '0x0000000000000000000000000000000000000001' as Address) : '0x0000000000000000000000000000000000000001' as Address

  const lenders = useMemo(
    () => (activeChainId ? getLendersForChain(activeChainId) : []),
    [activeChainId],
  )

  const { markets: morphoMarkets, loading: morphoLoading, error: morphoError } = useMorphoMarkets(activeChainId)

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
            conditions.push({
              lenderId: protocolToLenderId(lender.id),
              pool: poolConfig.pool,
              minHealthFactor: hf,
            })
          }
        } else if (lender.family === 'COMPOUND_V3') {
          const comet = COMPOUND_V3_POOLS[cid]?.[lender.id]
          if (comet) {
            conditions.push({
              lenderId: protocolToLenderId(lender.id),
              comet,
              assetBitmap: 0xFFFF,
              minHealthFactor: hf,
            })
          }
        } else if (lender.family === 'MORPHO_BLUE') {
          const morpho = MORPHO_BLUE_ADDRESSES[cid]
          if (morpho && morphoMarkets.length > 0) {
            for (const item of morphoMarkets) {
              const raw = item.params.market.id
              const mid = raw && !raw.startsWith('0x') ? `0x${raw}` : raw
              if (mid && mid.length === 66) {
                conditions.push({
                  lenderId: protocolToLenderId(lender.id),
                  morpho,
                  marketId: mid as Hex,
                  minHealthFactor: hf,
                })
              }
            }
          }
        }
      }
    }

    const settlementData =
      conditions.length > 0
        ? encodeSettlementData([], conditions)
        : ('0x' as Hex)
    const orderData = encodeOrderData(merkleRoot, settlementData)

    return { orderData, settlementData, conditionCount: conditions.length }
  }, [merkleRoot, activeChainId, hfMode, minHealthFactor, perLenderHealthFactor, selectedLenders, selectedTokenPerms, morphoMarkets])

  const handleCopyOrderData = useCallback(() => {
    if (orderData) {
      void navigator.clipboard.writeText(orderData)
    }
  }, [orderData])

  const { signPermission, signedPermissions, signing, error, clearSignatures } =
    usePermitSignatures(settlementAddress)

  const {
    submitOrder,
    submitting: orderSubmitting,
    submitted: orderSubmitted,
    error: orderError,
    settlementAddress: deployedSettlement,
  } = useOrderSubmission(activeChainId)

  const handleSubmitOrder = useCallback(() => {
    if (!merkleRoot || !orderData) return
    submitOrder({
      merkleRoot,
      settlementData: encodedSettlementData,
      orderData,
      leaves: allLeaves,
    })
  }, [merkleRoot, orderData, encodedSettlementData, allLeaves, submitOrder])

  const handleChainSelect = useCallback(
    (chainId: number) => {
      setSelectedChainId(chainId)
      setSelectedLenderIds(new Set())
      setSelectedTokenPerms({})
      setPerLenderHealthFactor({})
      clearSignatures()
      if (isConnected && chainId !== connectedChainId) {
        switchChain({ chainId })
      }
    },
    [isConnected, connectedChainId, switchChain, clearSignatures],
  )

  const handleToggleLender = useCallback((lenderId: string) => {
    setSelectedLenderIds((prev) => {
      const next = new Set(prev)
      if (next.has(lenderId)) {
        next.delete(lenderId)
        setSelectedTokenPerms(prev => {
          const copy = { ...prev }
          delete copy[lenderId]
          return copy
        })
        setPerLenderHealthFactor(prev => {
          const copy = { ...prev }
          delete copy[lenderId]
          return copy
        })
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
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return { ...prev, [protocolId]: next }
    })
  }, [])

  const handleSelectAllTokenPerms = useCallback((protocolId: string, keys: string[]) => {
    setSelectedTokenPerms(prev => {
      const current = prev[protocolId] ?? new Set<string>()
      const allSelected = keys.every(k => current.has(k))
      if (allSelected) {
        return { ...prev, [protocolId]: new Set<string>() }
      } else {
        return { ...prev, [protocolId]: new Set(keys) }
      }
    })
  }, [])

  const handleSignAll = useCallback(() => {
    if (!activeChainId) return
    const rows = buildPermissionRows(activeChainId, selectedLenders, selectedTokenPerms)
    for (const row of rows) {
      const alreadySigned = signedPermissions.some(s => s.request.label === row.key)
      if (!alreadySigned) {
        signPermission({
          kind: row.kind,
          label: row.key,
          targetAddress: row.targetAddress,
          chainId: row.chainId,
        })
      }
    }
  }, [activeChainId, selectedLenders, selectedTokenPerms, signedPermissions, signPermission])

  return (
    <div className="min-h-screen flex flex-col bg-base-100">
      {/* Navbar */}
      <nav className="navbar bg-base-200 border-b border-base-300 px-4">
        <div className="navbar-start">
          <h1 className="text-lg font-bold">1delta Agents Gateway</h1>
        </div>
        <div className="navbar-end gap-3">
          <ThemeSelector />
          <ConnectButton />
        </div>
      </nav>

      {/* Main content */}
      <main className="flex-1 px-4 py-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Chain selector */}
          <section>
            <ChainSelector
              selectedChainId={activeChainId}
              onSelect={handleChainSelect}
            />
          </section>

          {activeChainId && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* Column 1: Lenders */}
              <section className="lg:col-span-3">
                <div className="card bg-base-200 border border-base-300">
                  <div className="card-body p-3">
                    <LenderList
                      lenders={lenders}
                      selectedLenders={selectedLenderIds}
                      onToggle={handleToggleLender}
                    />
                  </div>
                </div>
              </section>

              {/* Column 2: Tokens */}
              <section className="lg:col-span-5">
                {selectedLenders.length > 0 ? (
                  <div>
                    <h2 className="text-lg font-bold mb-2">Tokens</h2>
                    <div className="space-y-2">
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
                        <div className="card card-compact bg-base-200 border border-base-300">
                          <div className="card-body p-0">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
                              <span className="text-sm font-semibold text-info">Morpho Blue</span>
                              <span className="badge badge-success badge-xs gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                All permissioned
                              </span>
                            </div>
                            <div className="px-3 py-2">
                              <span className="text-xs text-base-content/50">
                                {morphoLoading
                                  ? <span className="loading loading-dots loading-xs" />
                                  : morphoError
                                    ? <span className="text-error">{morphoError}</span>
                                    : `${morphoMarkets.length} market${morphoMarkets.length !== 1 ? 's' : ''} (TVL > $100k)`}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}

                      {selectedLenders.filter(l => l.family === 'COMPOUND_V3').map(lender => (
                        <div key={lender.id} className="card card-compact bg-base-200 border border-base-300">
                          <div className="card-body p-0">
                            <div className="flex items-center justify-between px-3 py-2 border-b border-base-300">
                              <span className="text-sm font-semibold text-accent">{lender.label}</span>
                              <span className="badge badge-success badge-xs gap-1">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                                All permissioned
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>

              {/* Column 3: Permissions */}
              <section className="lg:col-span-4">
                <div className="card bg-base-200 border border-base-300">
                  <div className="card-body p-3">
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
                  </div>
                </div>
              </section>
            </div>
          )}

          {/* Health Factor + Merkle + Order */}
          {activeChainId && selectedLenders.some(l => l.family === 'AAVE' || l.family === 'COMPOUND_V3' || l.family === 'MORPHO_BLUE') && (
            <section className="space-y-4">
              {/* Liquidation Preventer */}
              <div className="card bg-base-200 border border-base-300">
                <div className="card-body p-4">
                  <h2 className="card-title text-base">Liquidation Preventer</h2>
                  <p className="text-xs text-base-content/50">
                    Min health factor after settlement (e.g. 1.05 = 5% buffer). Leave empty for no condition.
                  </p>

                  <div className="flex flex-wrap items-center gap-4 mt-2">
                    <label className="label cursor-pointer gap-2">
                      <input
                        type="radio"
                        name="hf-mode"
                        className="radio radio-primary radio-xs"
                        checked={hfMode === 'all'}
                        onChange={() => setHfMode('all')}
                      />
                      <span className="label-text text-sm">All lenders</span>
                    </label>
                    <label className="label cursor-pointer gap-2">
                      <input
                        type="radio"
                        name="hf-mode"
                        className="radio radio-primary radio-xs"
                        checked={hfMode === 'per_lender'}
                        onChange={() => setHfMode('per_lender')}
                      />
                      <span className="label-text text-sm">Per lender</span>
                    </label>
                  </div>

                  {hfMode === 'all' ? (
                    <input
                      type="number"
                      min="1"
                      step="0.05"
                      placeholder="e.g. 1.2"
                      value={minHealthFactor}
                      onChange={(e) => setMinHealthFactor(e.target.value)}
                      className="input input-bordered input-sm w-full max-w-xs mt-1"
                    />
                  ) : (
                    <div className="space-y-2 mt-1">
                      {lendersForSafety.length === 0 ? (
                        <div className="text-sm text-base-content/40">Select lenders first.</div>
                      ) : (
                        lendersForSafety.map((lender) => {
                          const raw = perLenderHealthFactor[lender.id] ?? ''
                          const num = raw.trim() ? parseFloat(raw) : 0

                          const cid = String(activeChainId)
                          const willApply =
                            num >= 1.0 &&
                            (lender.family === 'COMPOUND_V3'
                              ? Boolean(COMPOUND_V3_POOLS[cid]?.[lender.id])
                              : lender.family === 'AAVE'
                                ? Boolean(AAVE_POOLS[lender.id]?.[cid]) &&
                                  Boolean(selectedTokenPerms[lender.id] && selectedTokenPerms[lender.id].size > 0)
                                : lender.family === 'MORPHO_BLUE'
                                  ? Boolean(MORPHO_BLUE_ADDRESSES[cid]) && morphoMarkets.length > 0
                                  : false)

                          return (
                            <div key={lender.id} className="flex items-center gap-3">
                              <div className="text-sm min-w-40 flex items-center gap-2">
                                <span>{lender.label}</span>
                                <span className={`badge badge-xs ${willApply ? 'badge-success' : 'badge-ghost'}`}>
                                  {willApply ? 'Active' : 'Inactive'}
                                </span>
                              </div>
                              <input
                                type="number"
                                min="1"
                                step="0.05"
                                placeholder="e.g. 1.2"
                                value={perLenderHealthFactor[lender.id] ?? ''}
                                onChange={(e) =>
                                  setPerLenderHealthFactor((prev) => ({ ...prev, [lender.id]: e.target.value }))
                                }
                                className="input input-bordered input-sm w-full max-w-xs"
                              />
                            </div>
                          )
                        })
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Merkle Panel */}
              <div className="card bg-base-200 border border-base-300">
                <div className="card-body p-4">
                  <MerklePanel
                    chainId={activeChainId}
                    selectedLenders={selectedLenders}
                    selectedTokenPerms={selectedTokenPerms}
                    morphoMarkets={morphoMarkets}
                    onRootChange={handleRootChange}
                  />
                </div>
              </div>

              {/* Order Data */}
              {orderData && (
                <div className="card bg-base-200 border border-warning/30">
                  <div className="card-body p-4">
                    <h2 className="card-title text-base text-warning">Order Data</h2>
                    <p className="text-xs text-base-content/50">
                      {conditionCount > 0
                        ? hfMode === 'all'
                          ? `Conditions: ${conditionCount}, min HF: ${minHealthFactor || '--'}`
                          : `Conditions: ${conditionCount}, per-lender HF`
                        : 'No conditions'}
                      {deployedSettlement
                        ? ` | Settlement: ${deployedSettlement.slice(0, 6)}...${deployedSettlement.slice(-4)}`
                        : ' | No settlement on this chain'}
                    </p>

                    <div className="flex items-start gap-3 mt-1">
                      <pre className="flex-1 text-xs font-mono break-all overflow-x-auto max-h-20 overflow-y-auto bg-base-300 rounded-lg p-2 text-base-content/70">
                        {orderData}
                      </pre>
                      <div className="shrink-0 flex flex-col gap-1.5">
                        <button
                          type="button"
                          onClick={handleCopyOrderData}
                          className="btn btn-xs btn-outline btn-warning"
                        >
                          Copy
                        </button>
                        <button
                          type="button"
                          onClick={handleSubmitOrder}
                          disabled={orderSubmitting || !deployedSettlement || !isConnected}
                          className="btn btn-xs btn-primary"
                        >
                          {orderSubmitting ? <span className="loading loading-spinner loading-xs" /> : 'Sign & Submit'}
                        </button>
                      </div>
                    </div>

                    {orderSubmitted && (
                      <div className="alert alert-success py-2 mt-2">
                        <span className="text-xs">Order submitted! ID: {orderSubmitted.id}</span>
                      </div>
                    )}
                    {orderError && (
                      <div className="alert alert-error py-2 mt-2">
                        <span className="text-xs">{orderError}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="footer footer-center p-3 bg-base-200 text-base-content/40 border-t border-base-300">
        <p className="text-xs">1delta Agents Gateway</p>
      </footer>
    </div>
  )
}
