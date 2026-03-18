import { describe, it, expect } from 'vitest'
import type { Hex } from 'viem'
import {
  encodeSettlementData,
  encodeMigrationSettlementData,
  encodeOrderData,
  encodeExecutionData,
  encodeFillerCalldata,
} from '../src/calldata.js'
import { AmountSentinel } from '../src/constants.js'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const ORACLE = '0x0000000000000000000000000000000000000001' as const
const POOL = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as const
const USER = '0x000000000000000000000000000000000000cafe' as const
const ZERO = '0x0000000000000000000000000000000000000000' as const

describe('encodeSettlementData', () => {
  it('encodes zero conversions', () => {
    const data = encodeSettlementData([])
    // 1 byte: numConversions = 0
    expect(data).toBe('0x00')
  })

  it('encodes one conversion (69 bytes total)', () => {
    const data = encodeSettlementData([{
      assetIn: WETH,
      assetOut: USDT,
      oracle: ORACLE,
      swapTolerance: 50_000n,
    }])

    // 1 (numConversions) + 68 (conversion) = 69 bytes
    expect((data.length - 2) / 2).toBe(69)
    // First byte = 0x01
    expect(data.slice(0, 4)).toBe('0x01')
  })

  it('encodes conversions with conditions', () => {
    const data = encodeSettlementData(
      [{ assetIn: WETH, assetOut: USDT, oracle: ORACLE, swapTolerance: 50_000n }],
      [{ lenderId: 0, pool: POOL, minHealthFactor: 1_500_000_000_000_000_000n }],
    )

    // 1 + 68 + 1 (numConditions) + 36 (aave condition) = 106 bytes
    expect((data.length - 2) / 2).toBe(106)
  })
})

describe('encodeMigrationSettlementData', () => {
  it('encodes 61 bytes', () => {
    const data = encodeMigrationSettlementData(POOL, POOL, USDC)
    // 1 + 20 + 20 + 20 = 61
    expect((data.length - 2) / 2).toBe(61)
    // First byte = intentType = 1
    expect(data.slice(0, 4)).toBe('0x01')
  })
})

describe('encodeOrderData', () => {
  it('encodes root + empty settlement data', () => {
    const root = '0x' + 'ab'.repeat(32) as Hex
    const data = encodeOrderData(root)

    // 32 (root) + 2 (sdLen=0) = 34 bytes
    expect((data.length - 2) / 2).toBe(34)
    // Root at start
    expect(data.slice(2, 66)).toBe('ab'.repeat(32))
    // sdLen = 0
    expect(data.slice(66, 70)).toBe('0000')
  })

  it('encodes root + settlement data', () => {
    const root = '0x' + 'ab'.repeat(32) as Hex
    const sd = encodeSettlementData([{
      assetIn: WETH,
      assetOut: USDT,
      oracle: ORACLE,
      swapTolerance: 50_000n,
    }])

    const data = encodeOrderData(root, sd)
    const sdLen = (sd.length - 2) / 2
    // 32 + 2 + sdLen
    expect((data.length - 2) / 2).toBe(34 + sdLen)
  })
})

describe('encodeExecutionData', () => {
  it('encodes header with zero actions', () => {
    const data = encodeExecutionData([], [])
    // 1 + 1 + 20 = 22 bytes header
    expect((data.length - 2) / 2).toBe(22)
    // numPre=0, numPost=0
    expect(data.slice(2, 6)).toBe('0000')
  })

  it('encodes header with fee recipient', () => {
    const data = encodeExecutionData([], [], USER)
    expect((data.length - 2) / 2).toBe(22)
    // fee recipient at bytes 2-22
    expect(data.slice(6, 46).toLowerCase()).toBe(USER.slice(2).toLowerCase())
  })

  it('encodes a single pre-action', () => {
    const proofSibling = '0x' + 'ff'.repeat(32) as Hex
    const data = encodeExecutionData([{
      asset: WETH,
      amount: AmountSentinel.MAX,
      receiver: USER,
      op: 2,
      lender: 0,
      data: '0xaabb',
      proof: [proofSibling],
    }], [])

    // Header (22) + action: 54 + 5 + 2(data) + 1 + 32(proof) = 94
    expect((data.length - 2) / 2).toBe(22 + 94)
    // numPre=1, numPost=0
    expect(data.slice(2, 4)).toBe('01')
    expect(data.slice(4, 6)).toBe('00')
  })
})

describe('encodeFillerCalldata', () => {
  it('returns 0x for no swaps', () => {
    expect(encodeFillerCalldata([])).toBe('0x')
  })

  it('encodes a single swap', () => {
    const swapCd = '0xdeadbeef' as Hex
    const data = encodeFillerCalldata([{
      assetIn: WETH,
      assetOut: USDT,
      amountIn: 1000000000000000000n,
      target: POOL,
      calldata: swapCd,
    }])

    // 20 + 20 + 14 + 20 + 2 + 4(calldata) = 80
    expect((data.length - 2) / 2).toBe(80)
  })

  it('encodes balance sentinel (amountIn=0)', () => {
    const data = encodeFillerCalldata([{
      assetIn: WETH,
      assetOut: USDT,
      amountIn: 0n,
      target: POOL,
      calldata: '0xaa',
    }])

    // Bytes 40-54 should be the 14-byte uint112 = 0
    const amountHex = data.slice(82, 110) // offset 40 bytes * 2 = 80, +2 for 0x prefix
    expect(BigInt('0x' + amountHex)).toBe(0n)
  })
})
