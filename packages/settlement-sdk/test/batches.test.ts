/**
 * Batches tests
 *
 * Logic: expandStableBatchToConditions maps a StableHealthBatch (one minHF + N members)
 * to a flat list of condition blobs (Hex[]) that match the settlementData condition
 * layout. batchesById builds an O(1) lookup map by batch id.
 *
 * Structure:
 * - expandStableBatchToConditions: one describe; four its (mixed Aave+Morpho, Aave-only,
 *   Morpho-only, same minHF applied to all). Each builds a batch, calls expand, asserts
 *   on output length and per-blob byte sizes (36 for Aave, 68 for Morpho).
 * - batchesById: one describe; one it that builds two batches, calls batchesById,
 *   asserts map[id] equals the batch and map['nonexistent'] is undefined.
 *
 * Asserts (all behavioral):
 * - Output length equals member count; each blob has contract-required size (36 or 68).
 * - Same minHF: last 14 bytes (minHF slot) of Aave and Morpho blobs are identical.
 * - batchesById: strict equality of looked-up batch; undefined for missing id.
 */
import { describe, it, expect } from 'vitest'
import { size } from 'viem'
import {
  expandStableBatchToConditions,
  batchesById,
  type StableHealthBatch,
} from '../src/batches.js'

// Fixtures for batch tests (distinct from conditions/calldata)
const POOL_A = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as const
const POOL_B = '0x794a61358D6845594F94dc1DB02A252b5b4814aD' as const
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as const
const MARKET_ID_1 =
  '0x1111111111111111111111111111111111111111111111111111111111111111' as const
const MARKET_ID_2 =
  '0x2222222222222222222222222222222222222222222222222222222222222222' as const

describe('expandStableBatchToConditions', () => {
  it('expands Aave + Morpho members to condition blobs with correct byte lengths', () => {
    const batch: StableHealthBatch = {
      id: 'stables-demo',
      label: 'Demo',
      minHealthFactor: 1_000_000_000_000_000_000n,
      members: [
        {
          kind: 'aave',
          lenderId: 0,
          pool: POOL_A,
        },
        {
          kind: 'morpho',
          lenderId: 4000,
          morpho: MORPHO,
          marketId: MARKET_ID_1 as `0x${string}`,
        },
      ],
    }
    const conds = expandStableBatchToConditions(batch)
    expect(conds.length).toBe(2)
    expect(size(conds[0])).toBe(36)
    expect(size(conds[1])).toBe(68)
  })

  it('expands Aave-only batch with all 36-byte blobs', () => {
    const batch: StableHealthBatch = {
      id: 'aave-only',
      label: 'Aave Only',
      minHealthFactor: 1_050_000_000_000_000_000n,
      members: [
        { kind: 'aave', lenderId: 0, pool: POOL_A },
        { kind: 'aave', lenderId: 0, pool: POOL_B },
      ],
    }
    const conds = expandStableBatchToConditions(batch)
    expect(conds.length).toBe(2)
    expect(size(conds[0])).toBe(36)
    expect(size(conds[1])).toBe(36)
  })

  it('expands Morpho-only batch with all 68-byte blobs', () => {
    const batch: StableHealthBatch = {
      id: 'morpho-only',
      label: 'Morpho Only',
      minHealthFactor: 1_100_000_000_000_000_000n,
      members: [
        { kind: 'morpho', lenderId: 4000, morpho: MORPHO, marketId: MARKET_ID_1 as `0x${string}` },
        { kind: 'morpho', lenderId: 4000, morpho: MORPHO, marketId: MARKET_ID_2 as `0x${string}` },
      ],
    }
    const conds = expandStableBatchToConditions(batch)
    expect(conds.length).toBe(2)
    expect(size(conds[0])).toBe(68)
    expect(size(conds[1])).toBe(68)
  })

  it('applies same minHealthFactor to all members', () => {
    const minHF = 1_200_000_000_000_000_000n
    const batch: StableHealthBatch = {
      id: 'same-hf',
      label: 'Same HF',
      minHealthFactor: minHF,
      members: [
        { kind: 'aave', lenderId: 0, pool: POOL_A },
        { kind: 'morpho', lenderId: 4000, morpho: MORPHO, marketId: MARKET_ID_1 as `0x${string}` },
      ],
    }
    const conds = expandStableBatchToConditions(batch)
    expect(conds.length).toBe(2)
    // Both blobs should encode minHF (minHF is in last 14 bytes of each condition)
    // Aave: [2: lenderId][20: pool][14: minHF] - minHF at bytes 22-36
    const aaveMinHFHex = conds[0].slice(-28) // last 14 bytes = 28 hex chars
    const morphoMinHFHex = conds[1].slice(-28) // last 14 bytes = 28 hex chars
    expect(aaveMinHFHex).toBe(morphoMinHFHex)
  })
})

describe('batchesById', () => {
  it('builds O(1) lookup map by batch id', () => {
    const batch1: StableHealthBatch = {
      id: 'batch-1',
      label: 'First',
      minHealthFactor: 1_000_000_000_000_000_000n,
      members: [{ kind: 'aave', lenderId: 0, pool: POOL_A }],
    }
    const batch2: StableHealthBatch = {
      id: 'batch-2',
      label: 'Second',
      minHealthFactor: 1_000_000_000_000_000_000n,
      members: [{ kind: 'morpho', lenderId: 4000, morpho: MORPHO, marketId: MARKET_ID_1 as `0x${string}` }],
    }
    const map = batchesById([batch1, batch2])

    expect(map['batch-1']).toEqual(batch1)
    expect(map['batch-2']).toEqual(batch2)
    expect(map['nonexistent']).toBeUndefined()
  })
})
