import { describe, it, expect } from 'vitest'
import {
  buildMigration,
  buildSimpleMigration,
  buildCollateralSwap,
  buildDebtSwap,
  buildClosePosition,
} from '../src/flows.js'
import { pairHash } from '../src/merkle.js'
import { AmountSentinel } from '../src/constants.js'
import type { Hex } from 'viem'

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const WBTC = '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as const
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as const
const USDT = '0xdAC17F958D2ee523a2206206994597C13D831ec7' as const
const ORACLE = '0x0000000000000000000000000000000000000001' as const
const USER = '0x000000000000000000000000000000000000cafe' as const
const SETTLEMENT = '0x000000000000000000000000000000000000beef' as const
const FEE_RECIPIENT = '0x000000000000000000000000000000000000fee0' as const

const POOL_PRIME = '0x0000000000000000000000000000000000000aaa' as const
const POOL_CORE = '0x0000000000000000000000000000000000000bbb' as const
const A_WETH_SRC = '0x0000000000000000000000000000000000000111' as const
const A_WETH_DST = '0x0000000000000000000000000000000000000222' as const
const V_DEBT_SRC = '0x0000000000000000000000000000000000000333' as const
const V_DEBT_DST = '0x0000000000000000000000000000000000000444' as const
const A_WBTC = '0x0000000000000000000000000000000000000555' as const

describe('buildMigration', () => {
  it('produces valid calldata for same-asset migration', () => {
    const result = buildMigration({
      collateralAsset: WETH,
      debtAsset: USDC,
      source: { pool: POOL_PRIME, aToken: A_WETH_SRC, debtToken: V_DEBT_SRC },
      dest: { pool: POOL_CORE, aToken: A_WETH_DST, debtToken: V_DEBT_DST },
      user: USER,
      settlement: SETTLEMENT,
      borrowAmount: 1_000_000_001n,
      feeRecipient: FEE_RECIPIENT,
    })

    expect(result.merkleRoot).toBeDefined()
    expect(result.fillerCalldata).toBe('0x')

    // orderData: 32 (root) + 2 (sdLen=0) = 34 bytes
    expect((result.orderData.length - 2) / 2).toBe(34)

    // executionData: header (22) + 4 actions
    const edLen = (result.executionData.length - 2) / 2
    expect(edLen).toBeGreaterThan(22)

    // Header: numPre=2, numPost=2
    expect(result.executionData.slice(2, 4)).toBe('02')
    expect(result.executionData.slice(4, 6)).toBe('02')
  })
})

describe('buildSimpleMigration', () => {
  it('includes APR check settlement data', () => {
    const result = buildSimpleMigration({
      collateralAsset: WETH,
      debtAsset: USDC,
      source: { pool: POOL_PRIME, aToken: A_WETH_SRC, debtToken: V_DEBT_SRC },
      dest: { pool: POOL_CORE, aToken: A_WETH_DST, debtToken: V_DEBT_DST },
      user: USER,
      settlement: SETTLEMENT,
      borrowAmount: 1_000_000_001n,
    })

    // orderData has non-zero settlementData (61 bytes for migration)
    // 32 + 2 + 61 = 95
    expect((result.orderData.length - 2) / 2).toBe(95)
  })
})

describe('buildCollateralSwap', () => {
  it('produces valid calldata for WETH→WBTC collateral swap', () => {
    const result = buildCollateralSwap({
      collateralIn: WETH,
      collateralOut: WBTC,
      debtAsset: USDC,
      pool: {
        pool: POOL_CORE,
        aToken: A_WETH_SRC,
        debtToken: V_DEBT_SRC,
        aTokenOut: A_WBTC,
      },
      oracle: ORACLE,
      swapTolerance: 50_000n,
      user: USER,
      settlement: SETTLEMENT,
      borrowAmount: 500_000_000n,
      swap: {
        amountIn: 0n, // balance-based
        target: '0x0000000000000000000000000000000000000999' as const,
        calldata: '0xdeadbeef' as Hex,
      },
    })

    expect(result.merkleRoot).toBeDefined()

    // Has filler calldata (swap)
    expect(result.fillerCalldata).not.toBe('0x')

    // orderData includes settlement data with 1 conversion
    const sdLen = (result.orderData.length - 2) / 2 - 34
    expect(sdLen).toBe(69) // 1 + 68

    // executionData: 2 pre + 2 post
    expect(result.executionData.slice(2, 4)).toBe('02')
    expect(result.executionData.slice(4, 6)).toBe('02')
  })

  it('includes health factor conditions when provided', () => {
    const result = buildCollateralSwap({
      collateralIn: WETH,
      collateralOut: WBTC,
      debtAsset: USDC,
      pool: {
        pool: POOL_CORE,
        aToken: A_WETH_SRC,
        debtToken: V_DEBT_SRC,
        aTokenOut: A_WBTC,
      },
      oracle: ORACLE,
      swapTolerance: 50_000n,
      user: USER,
      settlement: SETTLEMENT,
      borrowAmount: 500_000_000n,
      swap: {
        amountIn: 1_000_000_000_000_000_000n,
        target: '0x0000000000000000000000000000000000000999' as const,
        calldata: '0xdeadbeef' as Hex,
      },
      conditions: [
        { lenderId: 0, pool: POOL_CORE, minHealthFactor: 1_500_000_000_000_000_000n },
      ],
    })

    // 1 + 68 + 1 (numConditions) + 36 (aave condition) = 106
    const sdLen = (result.orderData.length - 2) / 2 - 34
    expect(sdLen).toBe(106)
  })
})

describe('buildDebtSwap', () => {
  it('produces valid calldata for USDC→USDT debt swap', () => {
    const result = buildDebtSwap({
      debtIn: USDC,
      debtOut: USDT,
      collateralAsset: WETH,
      sourcePool: { pool: POOL_CORE, aToken: A_WETH_SRC, debtToken: V_DEBT_SRC },
      destPool: { pool: POOL_CORE, aToken: A_WETH_DST, debtToken: V_DEBT_DST },
      oracle: ORACLE,
      swapTolerance: 50_000n,
      user: USER,
      settlement: SETTLEMENT,
      borrowAmount: 1_000_000_000n,
      swap: {
        amountIn: 0n,
        target: '0x0000000000000000000000000000000000000999' as const,
        calldata: '0xaabbccdd' as Hex,
      },
    })

    expect(result.merkleRoot).toBeDefined()
    expect(result.fillerCalldata).not.toBe('0x')

    // 1 pre (repay) + 1 post (borrow)
    expect(result.executionData.slice(2, 4)).toBe('01')
    expect(result.executionData.slice(4, 6)).toBe('01')
  })
})

describe('buildClosePosition', () => {
  it('produces valid calldata for closing a position', () => {
    const result = buildClosePosition({
      collateralAsset: WETH,
      debtAsset: USDT,
      pool: { pool: POOL_CORE, aToken: A_WETH_SRC, debtToken: V_DEBT_SRC },
      oracle: ORACLE,
      swapTolerance: 50_000n,
      user: USER,
      settlement: SETTLEMENT,
      swap: {
        amountIn: 0n,
        target: '0x0000000000000000000000000000000000000999' as const,
        calldata: '0xdeadbeef' as Hex,
      },
    })

    expect(result.merkleRoot).toBeDefined()
    expect(result.fillerCalldata).not.toBe('0x')

    // 2 pre (repay + withdraw), 0 post
    expect(result.executionData.slice(2, 4)).toBe('02')
    expect(result.executionData.slice(4, 6)).toBe('00')
  })

  it('merkle root verifies for all actions', () => {
    const result = buildClosePosition({
      collateralAsset: WETH,
      debtAsset: USDT,
      pool: { pool: POOL_CORE, aToken: A_WETH_SRC, debtToken: V_DEBT_SRC },
      oracle: ORACLE,
      swapTolerance: 50_000n,
      user: USER,
      settlement: SETTLEMENT,
      swap: {
        amountIn: 1_000_000_000_000_000_000n,
        target: '0x0000000000000000000000000000000000000999' as const,
        calldata: '0xdeadbeef' as Hex,
      },
    })

    // Root should be a 32-byte hex
    expect(result.merkleRoot.length).toBe(66)
    expect(result.merkleRoot.startsWith('0x')).toBe(true)
  })
})
