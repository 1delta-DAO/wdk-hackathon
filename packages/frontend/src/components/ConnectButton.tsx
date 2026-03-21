import { useState, useRef, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect, useBalance } from 'wagmi'
import { LogOut, ChevronRight, Wallet, Copy, Check, X } from 'react-feather'

/** Well-known wallet connector icons (base64 SVG or emoji fallback) */
function ConnectorIcon({ name }: { name: string }) {
  const n = name.toLowerCase()
  if (n.includes('metamask')) {
    return (
      <svg width="20" height="20" viewBox="0 0 35 33" xmlns="http://www.w3.org/2000/svg">
        <path d="M32.96 1l-13.14 9.72 2.45-5.73L32.96 1z" fill="#E2761B" stroke="#E2761B" strokeWidth=".25"/>
        <path d="M2.66 1l13.02 9.81L13.35 4.99 2.66 1zM28.23 23.53l-3.5 5.34 7.49 2.06 2.14-7.28-6.13-.12zM.88 23.65l2.13 7.28 7.47-2.06-3.48-5.34-6.12.12z" fill="#E4761B" stroke="#E4761B" strokeWidth=".25"/>
        <path d="M10.17 14.51l-2.07 3.13 7.37.34-.26-7.93-5.04 4.46zM25.46 14.51l-5.12-4.55-.17 8.02 7.36-.34-2.07-3.13zM10.48 28.87l4.43-2.16-3.83-2.98-.6 5.14zM20.71 26.71l4.43 2.16-.59-5.14-3.84 2.98z" fill="#E4761B" stroke="#E4761B" strokeWidth=".25"/>
      </svg>
    )
  }
  if (n.includes('walletconnect')) {
    return (
      <svg width="20" height="20" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
        <circle cx="200" cy="200" r="200" fill="#3B99FC"/>
        <path d="M122.52 148.95c42.83-41.87 112.31-41.87 155.14 0l5.15 5.03a5.3 5.3 0 010 7.65l-17.62 17.22a2.8 2.8 0 01-3.87 0l-7.09-6.92c-29.88-29.21-78.34-29.21-108.22 0l-7.59 7.42a2.8 2.8 0 01-3.87 0l-17.62-17.22a5.3 5.3 0 010-7.65l5.59-5.53zm191.58 35.68l15.69 15.33a5.3 5.3 0 010 7.65l-70.7 69.11a5.6 5.6 0 01-7.75 0l-50.17-49.03a1.4 1.4 0 00-1.94 0l-50.17 49.03a5.6 5.6 0 01-7.75 0l-70.71-69.11a5.3 5.3 0 010-7.65l15.69-15.33a5.6 5.6 0 017.75 0l50.17 49.03a1.4 1.4 0 001.94 0l50.17-49.03a5.6 5.6 0 017.75 0l50.17 49.03a1.4 1.4 0 001.94 0l50.17-49.03a5.6 5.6 0 017.75 0z" fill="#fff"/>
      </svg>
    )
  }
  // Generic wallet icon fallback
  return <Wallet size={20} className="text-base-content/60" />
}

export function ConnectButton() {
  const { address, isConnected, chain } = useAccount()
  const { connect, connectors, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { data: balance } = useBalance({ address })
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const drawerRef = useRef<HTMLDivElement>(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Close on Escape
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const handleCopy = () => {
    if (!address) return
    void navigator.clipboard.writeText(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      {/* Trigger button */}
      {isConnected && address ? (
        <button
          onClick={() => setOpen(true)}
          className="btn btn-sm btn-ghost gap-1.5 font-mono text-xs"
        >
          <span className="w-2 h-2 rounded-full bg-success inline-block" />
          {address.slice(0, 6)}...{address.slice(-4)}
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          className="btn btn-sm btn-primary gap-1.5"
        >
          <Wallet size={14} />
          Connect
        </button>
      )}

      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 bg-black/40 z-40 transition-opacity" />
      )}

      {/* Sidebar drawer */}
      <div
        ref={drawerRef}
        className={`fixed top-0 right-0 h-full w-80 max-w-[85vw] bg-base-200 border-l border-base-300 z-50 shadow-2xl transform transition-transform duration-200 ease-out ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-base-300">
          <h2 className="text-sm font-bold">
            {isConnected ? 'Wallet' : 'Connect Wallet'}
          </h2>
          <button
            onClick={() => setOpen(false)}
            className="btn btn-ghost btn-xs btn-square"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-4 overflow-y-auto h-[calc(100%-49px)]">
          {isConnected && address ? (
            /* ── Connected state ── */
            <div className="space-y-4">
              {/* Account card */}
              <div className="bg-base-300/60 rounded-lg p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary to-secondary flex items-center justify-center">
                    <Wallet size={14} className="text-primary-content" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">{address}</div>
                    {chain && (
                      <div className="text-[11px] text-base-content/50">{chain.name}</div>
                    )}
                  </div>
                </div>

                {/* Balance */}
                {balance && (
                  <div className="text-sm font-semibold">
                    {parseFloat(balance.formatted).toFixed(4)} {balance.symbol}
                  </div>
                )}

                {/* Copy address */}
                <button onClick={handleCopy} className="btn btn-xs btn-ghost gap-1.5 w-full">
                  {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                  {copied ? 'Copied!' : 'Copy address'}
                </button>
              </div>

              {/* Disconnect */}
              <button
                onClick={() => { disconnect(); setOpen(false) }}
                className="btn btn-sm btn-outline btn-error w-full gap-1.5"
              >
                <LogOut size={14} />
                Disconnect
              </button>
            </div>
          ) : (
            /* ── Not connected ── */
            <div className="space-y-2">
              <p className="text-xs text-base-content/50 mb-3">
                Choose a wallet to connect
              </p>
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  onClick={() => {
                    connect({ connector })
                    setOpen(false)
                  }}
                  disabled={isPending}
                  className="btn btn-ghost w-full justify-between h-auto py-3 px-3 border border-base-300 hover:border-primary/40"
                >
                  <div className="flex items-center gap-3">
                    <ConnectorIcon name={connector.name} />
                    <span className="text-sm font-medium">{connector.name}</span>
                  </div>
                  <ChevronRight size={16} className="text-base-content/30" />
                </button>
              ))}
              {isPending && (
                <div className="text-center py-2">
                  <span className="loading loading-spinner loading-sm" />
                  <p className="text-xs text-base-content/50 mt-1">Connecting...</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
