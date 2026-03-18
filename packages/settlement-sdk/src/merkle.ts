import { keccak256, encodePacked, concatHex, type Hex } from 'viem'
import type { Address } from './constants.js'

// ── Leaf construction ───────────────────────────────────

export interface LeafParams {
  op: number
  lender: number
  data: Hex
}

/**
 * Build a merkle leaf: keccak256(abi.encodePacked(op, lender, data))
 */
export function buildLeaf(params: LeafParams): Hex {
  return keccak256(
    encodePacked(
      ['uint8', 'uint16', 'bytes'],
      [params.op, params.lender, params.data],
    ),
  )
}

// ── Tree construction ───────────────────────────────────

/**
 * Sorted-pair hash — same as the on-chain Merkle verification.
 * parent = keccak256(min(a,b) ++ max(a,b))
 */
export function pairHash(a: Hex, b: Hex): Hex {
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a]
  return keccak256(encodePacked(['bytes32', 'bytes32'], [lo, hi]))
}

/**
 * Build a complete merkle tree from an array of leaves.
 * Returns { root, proofs } where proofs[i] is the proof for leaves[i].
 *
 * Supports 1–N leaves. Pads to next power of 2 with zero hashes.
 */
export function buildMerkleTree(leaves: Hex[]): {
  root: Hex
  proofs: Hex[][]
} {
  if (leaves.length === 0) throw new Error('Empty leaves')
  if (leaves.length === 1) return { root: leaves[0], proofs: [[]] }

  // Pad to power of 2
  const size = nextPow2(leaves.length)
  const padded = [...leaves]
  const zeroHash = '0x' + '00'.repeat(32) as Hex
  while (padded.length < size) padded.push(zeroHash)

  // Build tree layers bottom-up
  const layers: Hex[][] = [padded]
  let current = padded
  while (current.length > 1) {
    const next: Hex[] = []
    for (let i = 0; i < current.length; i += 2) {
      next.push(pairHash(current[i], current[i + 1]))
    }
    layers.push(next)
    current = next
  }

  const root = layers[layers.length - 1][0]

  // Build proofs for original leaves
  const proofs: Hex[][] = []
  for (let leafIdx = 0; leafIdx < leaves.length; leafIdx++) {
    const proof: Hex[] = []
    let idx = leafIdx
    for (let layer = 0; layer < layers.length - 1; layer++) {
      const siblingIdx = idx ^ 1
      proof.push(layers[layer][siblingIdx])
      idx = idx >> 1
    }
    proofs.push(proof)
  }

  return { root, proofs }
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

// ── Lender data builders ────────────────────────────────

export const AaveData = {
  /** DEPOSIT data: [20: pool] */
  deposit(pool: Address): Hex {
    return encodePacked(['address'], [pool])
  },

  /** BORROW data: [1: mode][20: pool] — mode 2 = variable rate */
  borrow(pool: Address, mode: number = 2): Hex {
    return encodePacked(['uint8', 'address'], [mode, pool])
  },

  /** REPAY data: [1: mode][20: debtToken][20: pool] */
  repay(debtToken: Address, pool: Address, mode: number = 2): Hex {
    return encodePacked(['uint8', 'address', 'address'], [mode, debtToken, pool])
  },

  /** WITHDRAW data: [20: aToken][20: pool] */
  withdraw(aToken: Address, pool: Address): Hex {
    return encodePacked(['address', 'address'], [aToken, pool])
  },
}

export interface MorphoMarketParams {
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
}

export const MorphoData = {
  /**
   * BORROW / WITHDRAW data (117 bytes):
   * [20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho]
   */
  borrowOrWithdraw(market: MorphoMarketParams, morpho: Address, flags: number = 0): Hex {
    return encodePacked(
      ['address', 'address', 'address', 'address', 'uint128', 'uint8', 'address'],
      [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv, flags, morpho],
    )
  },

  /**
   * DEPOSIT / REPAY data (119+ bytes):
   * [20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho][2: cbLen][cbData]
   */
  depositOrRepay(market: MorphoMarketParams, morpho: Address, flags: number = 0, callbackData: Hex = '0x'): Hex {
    const cbLen = callbackData === '0x' ? 0 : (callbackData.length - 2) / 2
    const base = encodePacked(
      ['address', 'address', 'address', 'address', 'uint128', 'uint8', 'address', 'uint16'],
      [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv, flags, morpho, cbLen],
    )
    if (cbLen === 0) return base
    return concatHex([base, callbackData])
  },
}

// ── Order definition builder ────────────────────────────

export interface ActionDef {
  op: number
  lender: number
  data: Hex
}

/**
 * Define the set of operations the user approves for settlement.
 * Returns the merkle root (for signing) and per-action proofs (for execution).
 */
export function defineOrder(actions: ActionDef[]): {
  root: Hex
  leaves: Hex[]
  proofs: Hex[][]
} {
  const leaves = actions.map(a => buildLeaf(a))
  const { root, proofs } = buildMerkleTree(leaves)
  return { root, leaves, proofs }
}
