import { useCallback, useState } from 'react'
import { useAccount, useWalletClient } from 'wagmi'
import { encodeAbiParameters, maxUint256 } from 'viem'
import type { Hex } from 'viem'
import { SETTLEMENT_ADDRESSES, ORDER_BACKEND_URL } from '../config/settlements'
import type { GeneratedLeaf } from '../lib/merkle'
import {
  encodePermitCall,
  encodeAaveDelegationCall,
  encodeCompoundV3AuthCall,
  encodeMorphoAuthCall,
} from '@1delta/settlement-sdk'
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
  /** Deadline in seconds from now (default: 1 hour) */
  deadlineSeconds?: number
  /** Max fee in sub-basis-points (default: 5000 = 0.05%). Denominator is 1e7 so 1 bps = 1000. */
  maxFeeBps?: number
  /** Restrict to specific solver address (default: address(0) = permissionless) */
  solver?: `0x${string}`
  /** Signed authorization permits to embed in fillerCalldata (Aave, Compound, Morpho) */
  signedPermissions?: SignedPermission[]
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
      const maxFeeBps = params.maxFeeBps ?? 5000
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

      // Encode signed permissions as fillerCalldata (ABI-encoded bytes[])
      let fillerCalldata: Hex = '0x'
      if (params.signedPermissions && params.signedPermissions.length > 0) {
        const calls: Hex[] = params.signedPermissions.map(sp => {
          const { request, signature, deadline, nonce } = sp
          switch (request.kind) {
            case 'ERC2612_PERMIT':
              return encodePermitCall({
                token: request.targetAddress,
                owner: address,
                spender: settlementAddress,
                value: maxUint256,
                deadline,
                sig: signature,
              })
            case 'AAVE_DELEGATION':
              return encodeAaveDelegationCall({
                debtToken: request.targetAddress,
                delegator: address,
                delegatee: settlementAddress,
                value: maxUint256,
                deadline,
                sig: signature,
              })
            case 'COMPOUND_V3_ALLOW':
              return encodeCompoundV3AuthCall({
                comet: request.targetAddress,
                owner: address,
                manager: settlementAddress,
                isAllowed: true,
                nonce,
                expiry: deadline,
                sig: signature,
              })
            case 'MORPHO_AUTHORIZATION':
              return encodeMorphoAuthCall({
                morpho: request.targetAddress,
                authorizer: address,
                authorized: settlementAddress,
                isAuthorized: true,
                nonce,
                deadline,
                sig: signature,
              })
          }
        })
        fillerCalldata = encodeAbiParameters([{ type: 'bytes[]' }], [calls])
      }

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
          fillerCalldata,
          chainId,
          maxFeeBps,
          solver,
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
