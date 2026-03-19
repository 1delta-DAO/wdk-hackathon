/** Hex-encoded string (0x-prefixed) */
export type Hex = `0x${string}`

/** Ethereum address */
export type Address = `0x${string}`

/** The signed order as submitted by frontends */
export interface SignedOrder {
  order: {
    /** Merkle root of allowed actions */
    merkleRoot: Hex
    /** Expiry timestamp (unix seconds) */
    deadline: number
    /** Encoded settlement data (conversions + conditions) */
    settlementData: Hex
    /** Encoded order data: [32: merkleRoot][2: settlementDataLen][settlementData] */
    orderData: Hex
    /** Encoded execution data (pre/post actions, fee recipient) */
    executionData: Hex
    /** Encoded filler calldata (swap params for the solver) */
    fillerCalldata: Hex
    /** Chain ID this order targets */
    chainId: number
    /** Max fee in sub-basis-points (denominator 1e7) */
    maxFeeBps: number
  }
  /** EIP-712 signature (65-byte hex: r ++ s ++ v) */
  signature: Hex
  /** Address of the order signer (recovered or self-reported) */
  signer: Address
}

/** Stored order with server-side metadata */
export interface StoredOrder extends SignedOrder {
  /** Server-assigned unique ID */
  id: string
  /** Timestamp when the order was received */
  createdAt: number
  /** Current order status */
  status: 'open' | 'filled' | 'cancelled' | 'expired'
}

/** Query parameters for listing orders */
export interface OrderQuery {
  chainId?: number
  signer?: Address
  status?: StoredOrder['status']
}
