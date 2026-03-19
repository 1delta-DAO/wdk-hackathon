import { useCallback, useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import type { Address, Hex } from 'viem'
import { SETTLEMENT_ADDRESSES, ORDER_BACKEND_URL } from '../config/settlements'
import type { GeneratedLeaf } from '../lib/merkle'

// EIP-712 typed data for settlement orders
const MIGRATION_ORDER_TYPES = {
  MigrationOrder: [
    { name: 'merkleRoot', type: 'bytes32' },
    { name: 'deadline', type: 'uint48' },
    { name: 'settlementData', type: 'bytes' },
  ],
} as const

interface SubmitOrderParams {
  merkleRoot: Hex
  settlementData: Hex
  orderData: Hex
  leaves: GeneratedLeaf[]
  /** Deadline in seconds from now (default: 1 hour) */
  deadlineSeconds?: number
  /** Max fee in sub-basis-points (default: 0) */
  maxFeeBps?: number
}

interface SubmittedOrder {
  id: string
  status: string
}

export function useOrderSubmission(chainId: number | null) {
  const { address } = useAccount()
  const { data: walletClient } = useWalletClient()
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

      // Sign the EIP-712 order
      const signature = await walletClient.signTypedData({
        domain: {
          name: 'MigrationSettlement',
          version: '1',
          chainId,
          verifyingContract: settlementAddress,
        },
        types: MIGRATION_ORDER_TYPES,
        primaryType: 'MigrationOrder',
        message: {
          merkleRoot: params.merkleRoot,
          deadline,
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
          leaves: backendLeaves,
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
