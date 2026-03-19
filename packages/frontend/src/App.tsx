import { useState, useMemo, useCallback } from 'react'
import { useAccount, useChainId, useSwitchChain } from 'wagmi'
import type { Address } from 'viem'
import { ChainSelector } from './components/ChainSelector'
import { LenderList } from './components/LenderList'
import { AaveTokenSelector } from './components/AaveTokenSelector'
import { PermissionPanel, buildPermissionRows } from './components/PermissionPanel'
import { MerklePanel } from './components/MerklePanel'
import { ConnectButton } from './components/ConnectButton'
import {
  getLendersForChain,
  getAaveTokenPermissions,
} from './data/lenders'
import { usePermitSignatures } from './hooks/usePermitSignatures'

// TODO: replace with actual deployed settlement contract per chain
const SETTLEMENT_ADDRESS: Address = '0x0000000000000000000000000000000000000001'

/** Map of protocolId -> Set of "tokenType:tokenAddress" keys */
export type SelectedTokenPerms = Record<string, Set<string>>

export default function App() {
  const { isConnected } = useAccount()
  const connectedChainId = useChainId()
  const { switchChain } = useSwitchChain()

  const [selectedChainId, setSelectedChainId] = useState<number | null>(null)
  const [selectedLenderIds, setSelectedLenderIds] = useState<Set<string>>(new Set())
  const [selectedTokenPerms, setSelectedTokenPerms] = useState<SelectedTokenPerms>({})

  const activeChainId = selectedChainId ?? connectedChainId

  const lenders = useMemo(
    () => (activeChainId ? getLendersForChain(activeChainId) : []),
    [activeChainId],
  )

  const selectedLenders = useMemo(
    () => lenders.filter((l) => selectedLenderIds.has(l.id)),
    [lenders, selectedLenderIds],
  )

  const aaveLenders = useMemo(
    () => selectedLenders.filter(l => l.family === 'AAVE'),
    [selectedLenders],
  )

  const { signPermission, signedPermissions, signing, error, clearSignatures } =
    usePermitSignatures(SETTLEMENT_ADDRESS)

  const handleChainSelect = useCallback(
    (chainId: number) => {
      setSelectedChainId(chainId)
      setSelectedLenderIds(new Set())
      setSelectedTokenPerms({})
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
                  <div className="text-gray-500 text-sm py-8 text-center">
                    Compound V3 and Morpho permissions don't require token selection
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
                  settlementAddress={SETTLEMENT_ADDRESS}
                />
              </section>
            </div>
          )}

          {/* Merkle leaves section */}
          {activeChainId && selectedLenders.some(l => l.family === 'AAVE') && (
            <section>
              <MerklePanel
                chainId={activeChainId}
                selectedLenders={selectedLenders}
                selectedTokenPerms={selectedTokenPerms}
              />
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
