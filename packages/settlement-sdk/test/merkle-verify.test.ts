/**
 * verifyMerkleProof tests
 *
 * Logic: verifyMerkleProof(leaf, proof, root) recomputes the root from the leaf and
 * proof siblings using the same pairHash as the contract. It must return true iff
 * the recomputed root equals the given root.
 *
 * Structure:
 * - One describe('verifyMerkleProof') with six its: valid proof for every leaf in a
 *   4-leaf tree; wrong leaf (correct root+proof); tampered proof; wrong root;
 *   single-leaf tree with empty proof (true for leaf=root and for built root);
 *   single-leaf with wrong root (false).
 *
 * Asserts (all behavioral):
 * - For each leaf in a built tree: verifyMerkleProof(leaves[i], proofs[i], root) === true.
 * - Wrong leaf, tampered proof, or wrong root => false.
 * - Single-leaf: proof=[] and root=leaf => true; root=built root => true; root≠leaf => false.
 */
import { describe, it, expect } from 'vitest'
import type { Hex } from 'viem'
import { buildLeaf, buildMerkleTree, verifyMerkleProof, AaveData } from '../src/merkle.js'
import { LenderOps } from '../src/constants.js'

const POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as const
const DEBT = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const
const ATOKEN = '0x23878914EFE38d27C4D67Ab83ed1b93A74D4086a' as const

describe('verifyMerkleProof', () => {
  it('returns true for valid proof at each leaf index', () => {
    const leaves = [
      buildLeaf({ op: LenderOps.REPAY, lender: 0, data: AaveData.repay(DEBT, POOL) }),
      buildLeaf({ op: LenderOps.WITHDRAW, lender: 0, data: AaveData.withdraw(ATOKEN, POOL) }),
      buildLeaf({ op: LenderOps.DEPOSIT, lender: 0, data: AaveData.deposit(POOL) }),
      buildLeaf({ op: LenderOps.BORROW, lender: 0, data: AaveData.borrow(POOL) }),
    ]
    const { root, proofs } = buildMerkleTree(leaves)

    for (let i = 0; i < leaves.length; i++) {
      expect(verifyMerkleProof(leaves[i], proofs[i], root)).toBe(true)
    }
  })

  it('returns false for wrong leaf with correct root and proof', () => {
    const leaves = [
      buildLeaf({ op: 0, lender: 0, data: '0xaa' }),
      buildLeaf({ op: 1, lender: 0, data: '0xbb' }),
    ]
    const { root, proofs } = buildMerkleTree(leaves)

    const wrongLeaf = buildLeaf({ op: 2, lender: 0, data: '0xcc' })
    expect(verifyMerkleProof(wrongLeaf, proofs[0], root)).toBe(false)
  })

  it('returns false for tampered proof', () => {
    const leaves = [
      buildLeaf({ op: 0, lender: 0, data: '0xaa' }),
      buildLeaf({ op: 1, lender: 0, data: '0xbb' }),
    ]
    const { root, proofs } = buildMerkleTree(leaves)

    const tamperedProof = [...proofs[0]]
    tamperedProof[0] = (tamperedProof[0].slice(0, -2) + 'ff') as Hex
    expect(verifyMerkleProof(leaves[0], tamperedProof, root)).toBe(false)
  })

  it('returns false for wrong root', () => {
    const leaves = [
      buildLeaf({ op: 0, lender: 0, data: '0xaa' }),
      buildLeaf({ op: 1, lender: 0, data: '0xbb' }),
    ]
    const { root, proofs } = buildMerkleTree(leaves)

    const wrongRoot = '0x' + '00'.repeat(32) as Hex
    expect(verifyMerkleProof(leaves[0], proofs[0], wrongRoot)).toBe(false)
  })

  it('returns true for single-leaf tree with empty proof', () => {
    const leaf = buildLeaf({ op: 0, lender: 0, data: '0xaa' })
    const { root } = buildMerkleTree([leaf])

    expect(verifyMerkleProof(leaf, [], leaf)).toBe(true)
    expect(verifyMerkleProof(leaf, [], root)).toBe(true)
  })

  it('returns false for single-leaf tree with wrong root', () => {
    const leaf = buildLeaf({ op: 0, lender: 0, data: '0xaa' })
    const wrongRoot = '0x' + 'ff'.repeat(32) as Hex

    expect(verifyMerkleProof(leaf, [], wrongRoot)).toBe(false)
  })
})
