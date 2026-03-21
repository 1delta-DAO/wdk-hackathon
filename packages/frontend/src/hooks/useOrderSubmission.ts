import { useCallback, useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import type { Hex } from 'viem'
import { SETTLEMENT_ADDRESSES, ORDER_BACKEND_URL } from '../config/settlements'
import type { GeneratedLeaf } from '../lib/merkle'
import type { SignedPermission } from './usePermitSignatures'

// EIP-712 typed data for settlement orders
const INFINITE_ORDER_TYPES = {
  InfiniteOrder: [
    { name: 'merkleRoot', type: 'bytes32' },
    { name: 'deadline', type: 'uint48' },
    { name: 'maxFeeBps', type: 'uint256' },
    { name: 'solver', type: 'address' },
    { name: 'settlementData', type: 'bytes' },
  ],
} as const

interface SubmitOrderParams {
  merkleRoot: Hex
  settlementData: Hex
  orderData: Hex
  leaves: GeneratedLeaf[]
  /** Signed permits from usePermitSignatures (aToken permits, credit delegation, Morpho auth, etc.) */
  permits?: SignedPermission[]
  /** Deadline in seconds from now (default: 1 hour) */
  deadlineSeconds?: number
  /** Max fee in sub-basis-points (default: 0) */
  maxFeeBps?: number
  /** Restrict to specific solver address (default: address(0) = permissionless) */
  solver?: `0x${string}`
}

interface SubmittedOrder {
  id: string
  status: string
}

export function useOrderSubmission(chainId: number | null) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient({ chainId: chainId ?? undefined })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<SubmittedOrder | null>(null)
  const [error, setError] = useState<string | null>(null)

  const settlementAddress = chainId ? SETTLEMENT_ADDRESSES[chainId] : undefined

  const submitOrder = useCallback(async (params: SubmitOrderParams) => {
    if (!walletClient || !address || !chainId || !settlementAddress) {
      setError('Wallet not connected or chain not supported')
      return
    }

    setSubmitting(true)
    setError(null)
    setSubmitted(null)

    try {
      const deadline = Math.floor(Date.now() / 1000) + (params.deadlineSeconds ?? 3600)
      const maxFeeBps = params.maxFeeBps ?? 0
      const solver = params.solver ?? '0x0000000000000000000000000000000000000000'

      // Sign the EIP-712 order
      const signature = await walletClient.signTypedData({
        domain: {
          name: 'InfiniteSettlement',
          version: '1',
          chainId,
          verifyingContract: settlementAddress,
        },
        types: INFINITE_ORDER_TYPES,
        primaryType: 'InfiniteOrder',
        message: {
          merkleRoot: params.merkleRoot,
          deadline,
          maxFeeBps: BigInt(maxFeeBps),
          solver,
          settlementData: params.settlementData,
        },
      })

      // Build the backend payload with merkle leaves for fillers
      const backendLeaves = params.leaves.map(l => ({
        op: l.op,
        lender: l.lender,
        data: l.data,
        leaf: l.leaf,
        proof: [] as Hex[], // proofs are derived from the tree, fillers can recompute
      }))

      // Serialize signed permits so the solver/agent can bundle them in multicall
      const serializedPermits = (params.permits ?? []).map(p => ({
        kind: p.request.kind,
        targetAddress: p.request.targetAddress,
        deadline: p.deadline.toString(),
        nonce: p.nonce.toString(),
        v: p.signature.v,
        r: p.signature.r,
        s: p.signature.s,
      }))

      const body = {
        order: {
          merkleRoot: params.merkleRoot,
          deadline,
          settlementData: params.settlementData,
          orderData: params.orderData,
          executionData: '0x' as Hex,
          fillerCalldata: '0x' as Hex,
          chainId,
          maxFeeBps,
          solver,
          leaves: backendLeaves,
          permits: serializedPermits,
        },
        signature,
        signer: address,
      }

      const res = await fetch(`${ORDER_BACKEND_URL}/v1/orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error(err.error || `HTTP ${res.status}`)
      }

      const result = await res.json() as SubmittedOrder
      setSubmitted(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }, [walletClient, address, chainId, settlementAddress])

  return { submitOrder, submitting, submitted, error, settlementAddress }
}
