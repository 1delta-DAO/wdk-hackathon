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
import {
  getLendersForChain,
  getAaveTokenPermissions,
  AAVE_POOLS,
  COMPOUND_V3_POOLS,
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
type HfMode = 'all' | 'per_lender' // set per lender or all lenders

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

  const { markets: morphoMarkets, loading: morphoLoading } = useMorphoMarkets(activeChainId)

  const selectedLenders = useMemo(
    () => lenders.filter((l) => selectedLenderIds.has(l.id)),
    [lenders, selectedLenderIds],
  )

  const aaveLenders = useMemo(
    () => selectedLenders.filter(l => l.family === 'AAVE'),
    [selectedLenders],
  )

  const lendersForSafety = useMemo(
    () => selectedLenders.filter((l) => l.family === 'AAVE' || l.family === 'COMPOUND_V3'),
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
              assetBitmap: 0xFFFF, // all collateral assets
              minHealthFactor: hf,
            })
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
  }, [merkleRoot, activeChainId, hfMode, minHealthFactor, perLenderHealthFactor, selectedLenders, selectedTokenPerms])

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
        // Also remove token perms for this lender
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
        // Deselect all
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
    <div className="min-h-screen flex flex-col">
      {/* Header */}
      <header className="border-b border-gray-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Settlement Permissions</h1>
            <p className="text-sm text-gray-500">Pre-sign lending protocol authorizations</p>
          </div>
          <ConnectButton />
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          {/* Step 1: Chain */}
          <section>
            <ChainSelector
              selectedChainId={activeChainId}
              onSelect={handleChainSelect}
            />
          </section>

          {activeChainId && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Column 1: Lender selection */}
              <section className="lg:col-span-3">
                <LenderList
                  lenders={lenders}
                  selectedLenders={selectedLenderIds}
                  onToggle={handleToggleLender}
                />
              </section>

              {/* Column 2: Token selection (for Aave protocols) */}
              <section className="lg:col-span-5">
                {aaveLenders.length > 0 ? (
                  <div>
                    <h2 className="text-lg font-semibold mb-3 text-gray-300">
                      Select Tokens
                    </h2>
                    <div className="space-y-3">
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
                    </div>
                  </div>
                ) : selectedLenders.length > 0 ? (
                  <div className="space-y-3">
                    {selectedLenders.some(l => l.family === 'MORPHO_BLUE') && (
                      <div className="rounded-lg border border-gray-800 bg-gray-900/50 px-4 py-3">
                        <div className="text-sm text-gray-300 font-medium">
                          Morpho Markets
                        </div>
                        <div className="text-xs text-gray-500 mt-1">
                          {morphoLoading
                            ? 'Loading markets...'
                            : `${morphoMarkets.length} market${morphoMarkets.length !== 1 ? 's' : ''} found (TVL > $100k)`}
                        </div>
                      </div>
                    )}
                    <div className="text-gray-500 text-sm py-4 text-center">
                      Compound V3 and Morpho permissions don't require token selection
                    </div>
                  </div>
                ) : null}
              </section>

              {/* Column 3: Permissions to sign */}
              <section className="lg:col-span-4">
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
              </section>
            </div>
          )}

          {/* HF (liquidation preventer) + Merkle + Order data */}
          {activeChainId && selectedLenders.some(l => l.family === 'AAVE' || l.family === 'COMPOUND_V3') && (
            <section className="space-y-6">
              {/* Health factor checks (Liquidation preventer) */}
              <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
                <h2 className="text-lg font-semibold text-gray-300 mb-2">
                  Liquidation Preventer
                </h2>
                <p className="text-sm text-gray-500 mb-3">
                  Minimum health factor after settlement (e.g. 1.05 = 5% buffer, 1.2 = 20% buffer).
                  Leave empty for no condition.
                </p>
                <div className="flex flex-wrap items-center gap-4 mb-4">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="radio"
                      name="hf-mode"
                      checked={hfMode === 'all'}
                      onChange={() => setHfMode('all')}
                    />
                    Set for all selected lenders
                  </label>
                  <label className="inline-flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="radio"
                      name="hf-mode"
                      checked={hfMode === 'per_lender'}
                      onChange={() => setHfMode('per_lender')}
                    />
                    Set per lender
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
                    className="w-full max-w-xs px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                  />
                ) : (
                  <div className="space-y-2">
                    {lendersForSafety.length === 0 ? (
                      <div className="text-sm text-gray-500">Select Aave or Compound V3 lenders first.</div>
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
                              : false)

                        return (
                          <div key={lender.id} className="flex items-center gap-3">
                            <div className="text-sm text-gray-300 min-w-44 flex items-center gap-2">
                              <span>{lender.label}</span>
                              <span
                                className={`text-[10px] px-2 py-0.5 rounded-full border ${
                                  willApply
                                    ? 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10'
                                    : 'text-gray-400 border-gray-700 bg-gray-800/50'
                                }`}
                                title={
                                  willApply
                                    ? 'This lender will be included in settlementData conditions'
                                    : 'Set HF ≥ 1.0 and ensure the lender has selections (Aave tokens / C3 market) to include it'
                                }
                              >
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
                            className="w-full max-w-xs px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
                          />
                          </div>
                        )
                      })
                    )}
                  </div>
                )}
              </div>

              <MerklePanel
                chainId={activeChainId}
                selectedLenders={selectedLenders}
                selectedTokenPerms={selectedTokenPerms}
                morphoMarkets={morphoMarkets}
                onRootChange={handleRootChange}
              />

              {/* Order data (signed payload) */}
              {orderData && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
                  <h2 className="text-lg font-semibold text-amber-400 mb-2">
                    Order Data
                  </h2>
                  <p className="text-sm text-gray-500 mb-2">
                    {conditionCount > 0
                      ? hfMode === 'all'
                        ? `Conditions: ${conditionCount}, min HF (all): ${minHealthFactor || '—'}`
                        : `Conditions: ${conditionCount}, min HF mode: per lender`
                      : 'No conditions'}
                    {deployedSettlement
                      ? ` · Settlement: ${deployedSettlement.slice(0, 6)}...${deployedSettlement.slice(-4)}`
                      : ' · No settlement deployed on this chain'}
                  </p>
                  <div className="flex items-start gap-3">
                    <pre className="flex-1 text-xs font-mono text-amber-200/90 break-all overflow-x-auto max-h-24 overflow-y-auto">
                      {orderData}
                    </pre>
                    <div className="shrink-0 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={handleCopyOrderData}
                        className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 text-sm font-medium"
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        onClick={handleSubmitOrder}
                        disabled={orderSubmitting || !deployedSettlement || !isConnected}
                        className="px-3 py-1.5 rounded-lg bg-indigo-500/20 text-indigo-400 hover:bg-indigo-500/30 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {orderSubmitting ? 'Signing...' : 'Sign & Submit'}
                      </button>
                    </div>
                  </div>
                  {orderSubmitted && (
                    <div className="mt-3 text-sm text-emerald-400">
                      Order submitted! ID: {orderSubmitted.id}
                    </div>
                  )}
                  {orderError && (
                    <div className="mt-3 text-sm text-red-400">
                      {orderError}
                    </div>
                  )}
                </div>
              )}
            </section>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-3">
        <div className="max-w-6xl mx-auto text-center text-xs text-gray-600">
          1delta Settlement - Hackathon
        </div>
      </footer>
    </div>
  )
}
