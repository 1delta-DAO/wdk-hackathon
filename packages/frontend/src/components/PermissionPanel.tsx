import type { Address } from 'viem'
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

/** Build the flat list of all permission rows to sign */
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
          key: `${lender.id}:${key}`,
          label: `${lender.label} - ${typeLabel} (${shortAddr})`,
          description: perm.tokenType === 'aToken'
            ? 'ERC-2612 permit for collateral aToken'
            : 'Credit delegation for variable debt token',
          targetAddress: perm.tokenAddress,
          kind: perm.kind,
          chainId,
        })
      }
    } else if (lender.family === 'COMPOUND_V3') {
      const target = COMPOUND_V3_POOLS[cid]?.[lender.id]
      if (!target) continue
      rows.push({
        key: `${lender.id}:COMPOUND_V3_ALLOW`,
        label: `${lender.label} - Manager Auth`,
        description: PERMISSION_DEFS.COMPOUND_V3_ALLOW.description,
        targetAddress: target,
        kind: 'COMPOUND_V3_ALLOW',
        chainId,
      })
    } else if (lender.family === 'MORPHO_BLUE') {
      const target = MORPHO_BLUE_ADDRESSES[cid]
      if (!target) continue
      rows.push({
        key: `MORPHO_BLUE:MORPHO_AUTHORIZATION`,
        label: 'Morpho Blue - Authorization',
        description: PERMISSION_DEFS.MORPHO_AUTHORIZATION.description,
        targetAddress: target,
        kind: 'MORPHO_AUTHORIZATION',
        chainId,
      })
    }
  }

  return rows
}

export function PermissionPanel({
  chainId,
  selectedLenders,
  selectedTokenPerms,
  signedPermissions,
  signing,
  error,
  onSign,
  onSignAll,
}: Props) {
  const rows = buildPermissionRows(chainId, selectedLenders, selectedTokenPerms)

  if (selectedLenders.length === 0) {
    return (
      <div className="text-base-content/40 text-sm py-8 text-center">
        Select lenders to see required permissions
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="text-base-content/40 text-sm py-8 text-center">
        Select tokens within each Aave protocol to build permissions
      </div>
    )
  }

  const signedKeys = new Set(signedPermissions.map(s => s.request.label))
  const signedCount = rows.filter(r => signedKeys.has(r.key)).length

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <h2 className="text-lg font-bold">Permissions</h2>
          <p className="text-xs text-base-content/40">{signedCount}/{rows.length} signed</p>
        </div>
        {rows.length > 0 && signedCount < rows.length && (
          <button
            onClick={onSignAll}
            disabled={!!signing}
            className="btn btn-sm btn-primary"
          >
            Sign All
          </button>
        )}
      </div>

      {error && (
        <div className="alert alert-error alert-sm mb-3">
          <span className="text-xs">{error}</span>
        </div>
      )}

      <div className="space-y-1 max-h-[60vh] overflow-y-auto">
        {rows.map((row) => {
          const signed = signedKeys.has(row.key)
          const isSigning = signing === row.key

          return (
            <div
              key={row.key}
              className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg border transition-all ${
                signed
                  ? 'border-success/30 bg-success/5'
                  : 'border-base-300 bg-base-200'
              }`}
            >
              <div className="min-w-0">
                <div className="text-xs font-medium truncate">{row.label}</div>
                <div className="text-[10px] text-base-content/40 mt-0.5">{row.description}</div>
              </div>
              <div className="shrink-0">
                {signed ? (
                  <span className="badge badge-success badge-xs gap-1">
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Signed
                  </span>
                ) : (
                  <button
                    onClick={() => onSign({
                      kind: row.kind,
                      label: row.key,
                      targetAddress: row.targetAddress,
                      chainId: row.chainId,
                    })}
                    disabled={isSigning}
                    className="btn btn-xs btn-primary"
                  >
                    {isSigning ? <span className="loading loading-spinner loading-xs" /> : 'Sign'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {signedCount === rows.length && rows.length > 0 && (
        <div className="alert alert-success mt-3">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-sm font-medium">All permissions signed! Ready to submit.</span>
        </div>
      )}
    </div>
  )
}
