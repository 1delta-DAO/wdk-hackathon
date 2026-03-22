import type { Address } from 'viem'
import { Check } from 'react-feather'
import { Reticle } from './icons/Reticle'
import type { LenderProtocol } from '../data/lenders'
import {
  PERMISSION_DEFS,
  getAaveTokenPermissions,
  MORPHO_BLUE_ADDRESSES,
  COMPOUND_V3_POOLS,
} from '../data/lenders'
import type { PermissionSignatureRequest, SignedPermission } from '../hooks/usePermitSignatures'
import type { SelectedTokenPerms } from '../App'

interface Props {
  chainId: number
  selectedLenders: LenderProtocol[]
  selectedTokenPerms: SelectedTokenPerms
  signedPermissions: SignedPermission[]
  signing: string | null
  error: string | null
  onSign: (request: PermissionSignatureRequest) => void
  onSignAll: () => void
  settlementAddress: Address
}

export interface PermissionRow {
  key: string
  label: string
  description: string
  targetAddress: Address
  kind: PermissionSignatureRequest['kind']
  chainId: number
}

export function buildPermissionRows(
  chainId: number,
  selectedLenders: LenderProtocol[],
  selectedTokenPerms: SelectedTokenPerms,
): PermissionRow[] {
  const rows: PermissionRow[] = []
  const cid = String(chainId)

  for (const lender of selectedLenders) {
    if (lender.family === 'AAVE') {
      const allPerms = getAaveTokenPermissions(lender.id, chainId)
      const selectedKeys = selectedTokenPerms[lender.id]
      if (!selectedKeys) continue
      for (const perm of allPerms) {
        const key = `${perm.tokenType}:${perm.tokenAddress}`
        if (!selectedKeys.has(key)) continue
        const shortAddr = `${perm.underlying.slice(0, 6)}...${perm.underlying.slice(-4)}`
        const typeLabel = perm.tokenType === 'aToken' ? 'Permit' : 'Delegation'
        rows.push({
          key: `${lender.id}:${key}`, label: `${lender.label} ${typeLabel} (${shortAddr})`,
          description: perm.tokenType === 'aToken' ? 'ERC-2612 permit' : 'Credit delegation',
          targetAddress: perm.tokenAddress, kind: perm.kind, chainId,
        })
      }
    } else if (lender.family === 'COMPOUND_V3') {
      const target = COMPOUND_V3_POOLS[cid]?.[lender.id]
      if (!target) continue
      rows.push({
        key: `${lender.id}:COMPOUND_V3_ALLOW`, label: `${lender.label} Auth`,
        description: PERMISSION_DEFS.COMPOUND_V3_ALLOW.description,
        targetAddress: target, kind: 'COMPOUND_V3_ALLOW', chainId,
      })
    } else if (lender.family === 'MORPHO_BLUE') {
      const target = MORPHO_BLUE_ADDRESSES[cid]
      if (!target) continue
      rows.push({
        key: `MORPHO_BLUE:MORPHO_AUTHORIZATION`, label: 'Morpho Auth',
        description: PERMISSION_DEFS.MORPHO_AUTHORIZATION.description,
        targetAddress: target, kind: 'MORPHO_AUTHORIZATION', chainId,
      })
    }
  }
  return rows
}

export function PermissionPanel({
  chainId, selectedLenders, selectedTokenPerms, signedPermissions,
  signing, error, onSign, onSignAll,
}: Props) {
  const rows = buildPermissionRows(chainId, selectedLenders, selectedTokenPerms)

  if (selectedLenders.length === 0) {
    return <div className="text-base-content/40 text-xs py-3 text-center">Select lenders first</div>
  }
  if (rows.length === 0) {
    return <div className="text-base-content/40 text-xs py-3 text-center">Select tokens to build permissions</div>
  }

  const signedKeys = new Set(signedPermissions.map(s => s.request.label))
  const signedCount = rows.filter(r => signedKeys.has(r.key)).length

  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[11px] text-base-content/40">{signedCount}/{rows.length} signed</span>
        {signedCount < rows.length && (
          <button onClick={onSignAll} disabled={!!signing} className="btn btn-xs btn-primary border-none">Sign All</button>
        )}
      </div>

      {error && <div className="alert alert-error py-1 mb-1.5 text-[11px]">{error}</div>}

      <div className="space-y-0.5 max-h-56 overflow-y-auto">
        {rows.map((row) => {
          const signed = signedKeys.has(row.key)
          const isSigning = signing === row.key
          return (
            <div key={row.key}
              className={`flex items-center justify-between gap-1.5 px-2 py-1.5 rounded text-xs transition-all ${
                signed ? 'bg-success/10' : 'bg-base-300/50'
              }`}>
              <div className="flex items-center gap-1.5 min-w-0">
                <Reticle size={12} className={signed ? 'text-success shrink-0' : 'text-base-content/20 shrink-0'} />
                <div className="min-w-0">
                  <div className="text-xs font-medium truncate">{row.label}</div>
                  <div className="text-[10px] text-base-content/30">{row.description}</div>
                </div>
              </div>
              {signed ? (
                <span className="flex items-center gap-0.5 text-[10px] text-success font-medium"><Check size={10} />Signed</span>
              ) : (
                <button onClick={() => onSign({ kind: row.kind, label: row.key, targetAddress: row.targetAddress, chainId: row.chainId })}
                  disabled={isSigning} className="btn btn-xs btn-primary border-none h-5 min-h-5">
                  {isSigning ? <span className="loading loading-spinner loading-xs" /> : 'Sign'}
                </button>
              )}
            </div>
          )
        })}
      </div>

      {signedCount === rows.length && rows.length > 0 && (
        <div className="alert alert-success py-1 mt-1.5 text-xs">
          <Check size={12} /> Ready to submit
        </div>
      )}
    </div>
  )
}
