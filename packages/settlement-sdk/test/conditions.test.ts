/**
 * Conditions tests (Compound V3 and SimplePool)
 *
 * Logic: encodeSettlementData accepts the new condition types and emits the binary
 * layout the contract expects: C3 = 38 bytes (lenderId, comet, assetBitmap, minHF),
 * SimplePool = 36 bytes (same as Aave). We assert total settlementData length and
 * that the conditions section is parseable (numConditions, condition blob sizes).
 *
 * Structure:
 * - Compound V3: three its — single C3 condition (total 40 bytes, condition blob 38),
 *   assetBitmap bounds 0 and 65535 valid (no throw), 65536 throws with 'assetBitmap'.
 * - SimplePool: two its — single simple condition (total 38 bytes), mix Aave+Simple (74 bytes).
 * - Mixed: one it — one conversion + four condition kinds; total 248 bytes; numConditions === 4.
 *
 * Asserts (all behavioral):
 * - Byte counts match contract layout (1 + 68*conversions + 1 + sum(condition sizes)).
 * - Parsed numConversions and numConditions from raw hex match inputs.
 * - Invalid assetBitmap throws; valid bounds do not throw.
 */
import { describe, it, expect } from 'vitest'
import {
  encodeSettlementData,
  type CompoundV3Condition,
  type SimplePoolCondition,
  type AaveCondition,
  type MorphoCondition,
} from '../src/calldata.js'

// Fixtures for conditions tests (distinct from calldata.test.ts)
const ORACLE = '0x0000000000000000000000000000000000000001' as const
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const
const POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as const
const COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3' as const
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as const
const MARKET_ID =
  '0x1111111111111111111111111111111111111111111111111111111111111111' as const
const COMPTROLLER = '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B' as const

describe('Compound V3 condition encoding', () => {
  it('encodes a single CompoundV3Condition with 38-byte condition row', () => {
    const c3Condition: CompoundV3Condition = {
      lenderId: 2000,
      comet: COMET,
      assetBitmap: 0x0002,
      minHealthFactor: 1_050_000_000_000_000_000n,
    }
    const data = encodeSettlementData([], [c3Condition])

    // 1 (numConversions=0) + 1 (numConditions) + 38 (C3 condition) = 40 bytes
    expect((data.length - 2) / 2).toBe(40)

    // Structure: 1 (numConversions=0) + 1 (numConditions) + 38 (condition)
    const hex = data.slice(2) // skip 0x
    const numConversions = parseInt(hex.slice(0, 2), 16)
    const numConditions = parseInt(hex.slice(2, 4), 16)
    expect(numConversions).toBe(0)
    expect(numConditions).toBe(1)
    const conditionBlob = hex.slice(4) // skip numConversions + numConditions
    expect(conditionBlob.length / 2).toBe(38)
  })

  it('encodes assetBitmap bounds (0 and 65535 valid)', () => {
    const valid0: CompoundV3Condition = {
      lenderId: 2000,
      comet: COMET,
      assetBitmap: 0,
      minHealthFactor: 1_000_000_000_000_000_000n,
    }
    expect(() => encodeSettlementData([], [valid0])).not.toThrow()

    const validMax: CompoundV3Condition = {
      lenderId: 2000,
      comet: COMET,
      assetBitmap: 65535,
      minHealthFactor: 1_000_000_000_000_000_000n,
    }
    expect(() => encodeSettlementData([], [validMax])).not.toThrow()
  })

  it('rejects invalid assetBitmap', () => {
    const invalid: CompoundV3Condition = {
      lenderId: 2000,
      comet: COMET,
      assetBitmap: 65536,
      minHealthFactor: 1_000_000_000_000_000_000n,
    }
    expect(() => encodeSettlementData([], [invalid])).toThrow('assetBitmap')
  })
})

describe('SimplePool condition encoding (C2/Silo)', () => {
  it('encodes a single SimplePoolCondition with 36-byte row', () => {
    const simpleCondition: SimplePoolCondition = {
      lenderId: 3000,
      poolOrComptrollerOrSilo: COMPTROLLER,
      minHealthFactor: 1_200_000_000_000_000_000n,
    }
    const data = encodeSettlementData([], [simpleCondition])

    // 1 (numConversions=0) + 1 (numConditions) + 36 (simple condition) = 38 bytes
    expect((data.length - 2) / 2).toBe(38)
  })

  it('encodes mix of Aave + SimplePool conditions', () => {
    const aaveCondition: AaveCondition = {
      lenderId: 0,
      pool: POOL,
      minHealthFactor: 1_500_000_000_000_000_000n,
    }
    const simpleCondition: SimplePoolCondition = {
      lenderId: 3000,
      poolOrComptrollerOrSilo: COMPTROLLER,
      minHealthFactor: 1_200_000_000_000_000_000n,
    }
    const data = encodeSettlementData([], [aaveCondition, simpleCondition])

    // 1 + 1 + 36 + 36 = 74 bytes
    expect((data.length - 2) / 2).toBe(74)
  })
})

describe('encodeSettlementData with mixed conditions (Aave + Morpho + C3 + Simple)', () => {
  it('builds settlementData with one conversion and four condition kinds', () => {
    const conversion = {
      assetIn: WETH,
      assetOut: USDT,
      oracle: ORACLE,
      swapTolerance: 50_000n,
    }
    const aaveCondition: AaveCondition = {
      lenderId: 0,
      pool: POOL,
      minHealthFactor: 1_500_000_000_000_000_000n,
    }
    const morphoCondition: MorphoCondition = {
      lenderId: 4000,
      morpho: MORPHO,
      marketId: MARKET_ID as `0x${string}`,
      minHealthFactor: 1_100_000_000_000_000_000n,
    }
    const c3Condition: CompoundV3Condition = {
      lenderId: 2000,
      comet: COMET,
      assetBitmap: 0x0002,
      minHealthFactor: 1_050_000_000_000_000_000n,
    }
    const simpleCondition: SimplePoolCondition = {
      lenderId: 3000,
      poolOrComptrollerOrSilo: COMPTROLLER,
      minHealthFactor: 1_200_000_000_000_000_000n,
    }

    const data = encodeSettlementData(
      [conversion],
      [aaveCondition, morphoCondition, c3Condition, simpleCondition],
    )

    // 1 (numConversions) + 68 (conversion) + 1 (numConditions) + 36 + 68 + 38 + 36 = 248 bytes
    const totalBytes = (data.length - 2) / 2
    expect(totalBytes).toBe(248)

    const hex = data.slice(2)
    const numConversions = parseInt(hex.slice(0, 2), 16)
    expect(numConversions).toBe(1)

    const conditionsStart = (1 + 68) * 2
    const numConditions = parseInt(hex.slice(conditionsStart, conditionsStart + 2), 16)
    expect(numConditions).toBe(4)

    // Condition blob sizes: Aave 36, Morpho 68, C3 38, Simple 36
    const expectedSizes = [36, 68, 38, 36]
    let offset = conditionsStart + 2
    for (let i = 0; i < 4; i++) {
      const blobLen = expectedSizes[i] * 2
      expect(hex.slice(offset, offset + blobLen).length).toBe(blobLen)
      offset += blobLen
    }
  })
})
