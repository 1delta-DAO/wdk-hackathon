import { useMemo } from 'react'
import { Shield, TrendingUp, TrendingDown, AlertTriangle } from 'react-feather'
import type { LenderPositions, Position } from '../hooks/useUserPositions'

interface Props {
  positions: LenderPositions[]
  loading: boolean
  error: string | null
}

function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(2)}K`
  if (v < 0.01) return '$0'
  return `$${v.toFixed(2)}`
}

function formatPct(v: number): string {
  return `${v.toFixed(2)}%`
}

function healthColor(health: number): string {
  if (health >= 2) return 'text-success'
  if (health >= 1.5) return 'text-info'
  if (health >= 1.1) return 'text-warning'
  return 'text-error'
}

function PositionRow({ position }: { position: Position }) {
  const asset = position.underlyingInfo?.asset
  const hasDeposits = position.depositsUSD > 0.01
  const hasDebt = position.debtUSD > 0.01
  if (!hasDeposits && !hasDebt) return null

  return (
    <div className="flex items-center gap-1.5 px-2 py-1">
      {asset?.logoURI && (
        <img src={asset.logoURI} alt={asset.symbol} className="w-3.5 h-3.5 rounded-full shrink-0 bg-white" />
      )}
      <span className="text-xs font-medium flex-1 truncate">{asset?.symbol ?? '???'}</span>
      {hasDeposits && (
        <span className="flex items-center gap-0.5 text-[11px] text-success">
          <TrendingUp size={10} />
          {formatUsd(position.depositsUSD)}
        </span>
      )}
      {hasDebt && (
        <span className="flex items-center gap-0.5 text-[11px] text-error">
          <TrendingDown size={10} />
          {formatUsd(position.debtUSD)}
        </span>
      )}
    </div>
  )
}

function LenderTile({ lender }: { lender: LenderPositions }) {
  const account = lender.data[0]
  if (!account) return null

  const activePositions = account.positions.filter(
    p => p.depositsUSD > 0.01 || p.debtUSD > 0.01,
  )
  if (activePositions.length === 0) return null

  const { health, balanceData, aprData } = account

  return (
    <div className="bg-base-300/50 rounded-lg border border-base-300 overflow-hidden">
      {/* Header row */}
      <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-base-300/60">
        <span className="text-xs font-bold truncate">{lender.lender.replace(/_/g, ' ')}</span>
        {health > 0 && (
          <span className={`flex items-center gap-0.5 text-[11px] font-semibold ${healthColor(health)}`}>
            <Shield size={10} />
            {health.toFixed(2)}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-1 px-2.5 py-1.5 border-b border-base-300/40 text-[11px]">
        <div>
          <div className="text-base-content/30">Supply</div>
          <div className="font-semibold text-success">{formatUsd(balanceData.deposits)}</div>
        </div>
        <div>
          <div className="text-base-content/30">Debt</div>
          <div className="font-semibold text-error">{formatUsd(balanceData.debt)}</div>
        </div>
        <div>
          <div className="text-base-content/30">APR</div>
          <div className="font-semibold">{formatPct(aprData.apr)}</div>
        </div>
      </div>

      {/* Positions */}
      <div className="divide-y divide-base-300/30 max-h-32 overflow-y-auto">
        {activePositions.map((p) => (
          <PositionRow key={p.marketUid} position={p} />
        ))}
      </div>
    </div>
  )
}

export function UserPositions({ positions, loading, error }: Props) {
  const activeLenders = useMemo(
    () => positions.filter(l =>
      l.data.some(d => d.positions.some(p => p.depositsUSD > 0.01 || p.debtUSD > 0.01)),
    ),
    [positions],
  )

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 justify-center text-base-content/40 text-xs">
        <span className="loading loading-spinner loading-xs" />
        Loading positions...
      </div>
    )
  }

  if (error) {
    return (
      <div className="alert alert-error py-1.5 text-xs">
        <AlertTriangle size={12} />
        <span>{error}</span>
      </div>
    )
  }

  if (activeLenders.length === 0) {
    return (
      <div className="text-base-content/40 text-xs py-4 text-center">
        No active positions found
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {activeLenders.map((lender) => (
        <LenderTile key={`${lender.lender}:${lender.chainId}`} lender={lender} />
      ))}
    </div>
  )
}
