/** Hex-encoded string (0x-prefixed) */
export type Hex = `0x${string}`

/** Ethereum address */
export type Address = `0x${string}`

/** A single merkle leaf — describes one approved lending action */
export interface MerkleLeaf {
  /** Operation type: 0=DEPOSIT, 1=BORROW, 2=REPAY, 3=WITHDRAW, 4=DEPOSIT_LENDING_TOKEN, 5=WITHDRAW_LENDING_TOKEN */
  op: number
  /** Lender ID (routes to protocol: <1000 Aave V3, <2000 Aave V2, <3000 Compound V3, etc.) */
  lender: number
  /** ABI-encoded lender-specific data (pool address, market params, etc.) */
  data: Hex
  /** The keccak256 leaf hash (keccak256(abi.encodePacked(op, lender, data))) */
  leaf: Hex
  /** Merkle proof siblings for this leaf */
  proof: Hex[]
}

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
    /** Merkle leaves — the full set of actions the user approved for this order */
    leaves: MerkleLeaf[]
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
