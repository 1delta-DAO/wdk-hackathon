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
  /** For Aave: set of "tokenType:tokenAddress" keys */
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
      // Per-token permissions
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
      <div className="text-gray-500 text-sm py-8 text-center">
        Select lenders to see required permissions
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="text-gray-500 text-sm py-8 text-center">
        Select tokens within each Aave protocol to build permissions
      </div>
    )
  }

  const signedKeys = new Set(signedPermissions.map(s => s.request.label))
  const signedCount = rows.filter(r => signedKeys.has(r.key)).length

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-300">
          Permissions to Sign
          <span className="text-gray-500 text-sm font-normal ml-2">
            ({signedCount}/{rows.length} signed)
          </span>
        </h2>
        {rows.length > 0 && signedCount < rows.length && (
          <button
            onClick={onSignAll}
            disabled={!!signing}
            className="px-4 py-1.5 rounded-md text-sm font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
          >
            Sign All
          </button>
        )}
      </div>

      {error && (
        <div className="mb-3 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
        {rows.map((row) => {
          const signed = signedKeys.has(row.key)
          const isSigning = signing === row.key

          return (
            <div
              key={row.key}
              className={`px-4 py-2.5 rounded-lg border transition-all ${
                signed
                  ? 'border-green-500/40 bg-green-500/5'
                  : 'border-gray-800 bg-gray-900/50'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-200 truncate">
                    {row.label}
                  </div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    {row.description}
                  </div>
                  <div className="text-xs text-gray-600 font-mono mt-0.5">
                    {row.targetAddress.slice(0, 6)}...{row.targetAddress.slice(-4)}
                  </div>
                </div>
                <div className="flex-shrink-0">
                  {signed ? (
                    <span className="inline-flex items-center gap-1 text-green-400 text-xs font-medium">
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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
                      className="px-3 py-1 rounded-md text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50"
                    >
                      {isSigning ? 'Signing...' : 'Sign'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {signedCount === rows.length && rows.length > 0 && (
        <div className="mt-4 px-4 py-3 rounded-lg bg-green-500/10 border border-green-500/30 text-green-400 text-sm text-center font-medium">
          All permissions signed! Ready to submit settlement.
        </div>
      )}
    </div>
  )
}
