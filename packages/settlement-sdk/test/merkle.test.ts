import { describe, it, expect } from 'vitest'
import { keccak256, encodePacked, type Hex } from 'viem'
import { buildLeaf, pairHash, buildMerkleTree, defineOrder, AaveData } from '../src/merkle.js'
import { LenderOps } from '../src/constants.js'

describe('buildLeaf', () => {
  it('matches Solidity keccak256(abi.encodePacked(op, lender, data))', () => {
    const leaf = buildLeaf({ op: 3, lender: 0, data: '0xaa' })
    const expected = keccak256(encodePacked(['uint8', 'uint16', 'bytes'], [3, 0, '0xaa']))
    expect(leaf).toBe(expected)
  })

  it('produces different leaves for different ops', () => {
    const l1 = buildLeaf({ op: 0, lender: 0, data: '0xaa' })
    const l2 = buildLeaf({ op: 1, lender: 0, data: '0xaa' })
    expect(l1).not.toBe(l2)
  })
})

describe('pairHash', () => {
  it('is commutative (sorted-pair)', () => {
    const a = '0x' + 'aa'.repeat(32) as Hex
    const b = '0x' + 'bb'.repeat(32) as Hex
    expect(pairHash(a, b)).toBe(pairHash(b, a))
  })

  it('matches the Solidity sorted-pair hash', () => {
    const a = '0x' + '01'.padStart(64, '0') as Hex
    const b = '0x' + '02'.padStart(64, '0') as Hex
    // a < b, so hash = keccak256(a ++ b)
    const expected = keccak256(encodePacked(['bytes32', 'bytes32'], [a, b]))
    expect(pairHash(a, b)).toBe(expected)
  })
})

describe('buildMerkleTree', () => {
  it('single leaf: root is the leaf itself', () => {
    const leaf = buildLeaf({ op: 0, lender: 0, data: '0xaa' })
    const { root, proofs } = buildMerkleTree([leaf])
    expect(root).toBe(leaf)
    expect(proofs[0]).toEqual([])
  })

  it('two leaves: root is pair hash', () => {
    const l0 = buildLeaf({ op: 3, lender: 0, data: '0xaa' })
    const l1 = buildLeaf({ op: 0, lender: 0, data: '0xbb' })
    const { root, proofs } = buildMerkleTree([l0, l1])

    expect(root).toBe(pairHash(l0, l1))
    expect(proofs[0]).toEqual([l1])
    expect(proofs[1]).toEqual([l0])
  })

  it('four leaves: matches manual tree construction', () => {
    const l0 = buildLeaf({ op: 2, lender: 0, data: '0x01' })
    const l1 = buildLeaf({ op: 3, lender: 0, data: '0x02' })
    const l2 = buildLeaf({ op: 0, lender: 0, data: '0x03' })
    const l3 = buildLeaf({ op: 1, lender: 0, data: '0x04' })

    const h01 = pairHash(l0, l1)
    const h23 = pairHash(l2, l3)
    const expectedRoot = pairHash(h01, h23)

    const { root, proofs } = buildMerkleTree([l0, l1, l2, l3])
    expect(root).toBe(expectedRoot)

    // Proof for l0: [l1, h23]
    expect(proofs[0]).toEqual([l1, h23])
    // Proof for l2: [l3, h01]
    expect(proofs[2]).toEqual([l3, h01])
  })

  it('proof verifies against root', () => {
    const leaves = [
      buildLeaf({ op: 0, lender: 0, data: '0xaa' }),
      buildLeaf({ op: 1, lender: 0, data: '0xbb' }),
      buildLeaf({ op: 2, lender: 0, data: '0xcc' }),
      buildLeaf({ op: 3, lender: 0, data: '0xdd' }),
    ]
    const { root, proofs } = buildMerkleTree(leaves)

    // Verify each proof by walking up the tree
    for (let i = 0; i < leaves.length; i++) {
      let hash = leaves[i]
      for (const sibling of proofs[i]) {
        hash = pairHash(hash, sibling)
      }
      expect(hash).toBe(root)
    }
  })

  it('three leaves padded to 4', () => {
    const l0 = buildLeaf({ op: 0, lender: 0, data: '0x01' })
    const l1 = buildLeaf({ op: 1, lender: 0, data: '0x02' })
    const l2 = buildLeaf({ op: 2, lender: 0, data: '0x03' })

    const { root, proofs } = buildMerkleTree([l0, l1, l2])

    // All proofs should verify
    for (let i = 0; i < 3; i++) {
      let hash = [l0, l1, l2][i]
      for (const sibling of proofs[i]) {
        hash = pairHash(hash, sibling)
      }
      expect(hash).toBe(root)
    }
  })
})

describe('AaveData', () => {
  const pool = '0x1234567890123456789012345678901234567890' as const
  const aToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd' as const
  const debtToken = '0xddeeff00ddeeff00ddeeff00ddeeff00ddeeff00' as const

  it('deposit encodes pool only (20 bytes)', () => {
    const data = AaveData.deposit(pool)
    expect((data.length - 2) / 2).toBe(20)
  })

  it('borrow encodes mode + pool (21 bytes)', () => {
    const data = AaveData.borrow(pool, 2)
    expect((data.length - 2) / 2).toBe(21)
  })

  it('repay encodes mode + debtToken + pool (41 bytes)', () => {
    const data = AaveData.repay(debtToken, pool, 2)
    expect((data.length - 2) / 2).toBe(41)
  })

  it('withdraw encodes aToken + pool (40 bytes)', () => {
    const data = AaveData.withdraw(aToken, pool)
    expect((data.length - 2) / 2).toBe(40)
  })
})

describe('defineOrder', () => {
  it('creates a valid merkle root and proofs for a migration', () => {
    const pool = '0x1234567890123456789012345678901234567890' as const
    const aToken = '0xaabbccddaabbccddaabbccddaabbccddaabbccdd' as const
    const debtToken = '0xddeeff00ddeeff00ddeeff00ddeeff00ddeeff00' as const

    const { root, leaves, proofs } = defineOrder([
      { op: LenderOps.REPAY, lender: 0, data: AaveData.repay(debtToken, pool) },
      { op: LenderOps.WITHDRAW, lender: 0, data: AaveData.withdraw(aToken, pool) },
      { op: LenderOps.DEPOSIT, lender: 0, data: AaveData.deposit(pool) },
      { op: LenderOps.BORROW, lender: 0, data: AaveData.borrow(pool) },
    ])

    expect(leaves.length).toBe(4)
    expect(proofs.length).toBe(4)

    // All proofs verify
    for (let i = 0; i < leaves.length; i++) {
      let hash = leaves[i]
      for (const sibling of proofs[i]) {
        hash = pairHash(hash, sibling)
      }
      expect(hash).toBe(root)
    }
  })
})
