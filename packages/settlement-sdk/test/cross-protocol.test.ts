import { describe, it, expect } from 'vitest'
import { Settlement } from '../src/settlement.js'
import { MorphoData, AaveData, pairHash, buildLeaf } from '../src/merkle.js'
import { LenderOps, AmountSentinel } from '../src/constants.js'
import type { MorphoMarketParams } from '../src/merkle.js'

// ── Mainnet addresses ──────────────────────────────────────

const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0' as const

// Aave V3 Core
const AAVE_V3_CORE = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as const
const A_WSTETH = '0x0B925eD163218f6662a35e0f0371Ac234f9E9371' as const
const V_DEBT_WETH = '0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE' as const

// Morpho Blue — wstETH/WETH market (96.5% LLTV)
const MORPHO_BLUE = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as const
const MORPHO_MARKET: MorphoMarketParams = {
  loanToken: WETH,
  collateralToken: WSTETH,
  oracle: '0xbD60A6770b27E084E8617335ddE769241B0e71D8',
  irm: '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC',
  lltv: 965_000_000_000_000_000n,
}

const USER = '0x000000000000000000000000000000000000cafe' as const
const SETTLEMENT = '0x000000000000000000000000000000000000beef' as const

// ── MorphoData tests ───────────────────────────────────────

describe('MorphoData', () => {
  it('borrowOrWithdraw produces 117 bytes', () => {
    const data = MorphoData.borrowOrWithdraw(MORPHO_MARKET, MORPHO_BLUE)
    // 20 + 20 + 20 + 20 + 16 + 1 + 20 = 117
    expect((data.length - 2) / 2).toBe(117)
  })

  it('depositOrRepay produces 119 bytes (no callback)', () => {
    const data = MorphoData.depositOrRepay(MORPHO_MARKET, MORPHO_BLUE)
    // 117 + 2 (cbLen=0) = 119
    expect((data.length - 2) / 2).toBe(119)
  })

  it('depositOrRepay with callback extends correctly', () => {
    const data = MorphoData.depositOrRepay(MORPHO_MARKET, MORPHO_BLUE, 0, '0xdeadbeef')
    // 119 + 4 = 123
    expect((data.length - 2) / 2).toBe(123)
  })
})

// ── Aave → Morpho migration test ──────────────────────────

describe('Settlement.buildCrossProtocolMigration: Aave wstETH/WETH → Morpho', () => {
  const result = Settlement.buildCrossProtocolMigration({
    collateralAsset: WSTETH,
    debtAsset: WETH,
    source: {
      protocol: 'aave',
      pool: { pool: AAVE_V3_CORE, aToken: A_WSTETH, debtToken: V_DEBT_WETH },
    },
    dest: {
      protocol: 'morpho',
      market: MORPHO_MARKET,
      morpho: MORPHO_BLUE,
    },
    user: USER,
    settlement: SETTLEMENT,
    borrowAmount: 10_000_000_000_000_000_001n, // slightly > debt to cover rounding
  })

  it('has a valid merkle root', () => {
    expect(result.merkleRoot.length).toBe(66)
    expect(result.merkleRoot.startsWith('0x')).toBe(true)
  })

  it('has no filler calldata (same-asset, no swap)', () => {
    expect(result.fillerCalldata).toBe('0x')
  })

  it('has 2 pre-actions and 2 post-actions', () => {
    expect(result.executionData.slice(2, 4)).toBe('02') // numPre
    expect(result.executionData.slice(4, 6)).toBe('02') // numPost
  })

  it('merkle tree contains Aave source + Morpho dest leaves', () => {
    const repayData = AaveData.repay(V_DEBT_WETH, AAVE_V3_CORE, 2)
    const withdrawData = AaveData.withdraw(A_WSTETH, AAVE_V3_CORE)
    const morphoDepositData = MorphoData.depositOrRepay(MORPHO_MARKET, MORPHO_BLUE)
    const morphoBorrowData = MorphoData.borrowOrWithdraw(MORPHO_MARKET, MORPHO_BLUE)

    const l0 = buildLeaf({ op: LenderOps.REPAY, lender: 0, data: repayData })
    const l1 = buildLeaf({ op: LenderOps.WITHDRAW, lender: 0, data: withdrawData })
    const l2 = buildLeaf({ op: LenderOps.DEPOSIT, lender: 4000, data: morphoDepositData })
    const l3 = buildLeaf({ op: LenderOps.BORROW, lender: 4000, data: morphoBorrowData })

    const h01 = pairHash(l0, l1)
    const h23 = pairHash(l2, l3)
    const expectedRoot = pairHash(h01, h23)

    expect(result.merkleRoot).toBe(expectedRoot)
  })

  it('execution data encodes correct action sizes', () => {
    // Verify executionData is non-trivial
    const edLen = (result.executionData.length - 2) / 2

    // Header (23) + 2 Aave actions + 2 Morpho actions
    // Aave repay: 54 + 5 + 41(data) + 1 + 2*32(proof) = 165
    // Aave withdraw: 54 + 5 + 40(data) + 1 + 2*32(proof) = 164
    // Morpho deposit: 54 + 5 + 119(data) + 1 + 2*32(proof) = 243
    // Morpho borrow: 54 + 5 + 117(data) + 1 + 2*32(proof) = 241
    // Total: 23 + 165 + 164 + 243 + 241 = 836
    expect(edLen).toBe(836)
  })

  it('orderData starts with the merkle root', () => {
    // First 32 bytes of orderData should be the merkle root
    expect(('0x' + result.orderData.slice(2, 66)) as `0x${string}`).toBe(result.merkleRoot)
  })
})

describe('Settlement.buildCrossProtocolMigration: with Morpho health factor condition', () => {
  const result = Settlement.buildCrossProtocolMigration({
    collateralAsset: WSTETH,
    debtAsset: WETH,
    source: {
      protocol: 'aave',
      pool: { pool: AAVE_V3_CORE, aToken: A_WSTETH, debtToken: V_DEBT_WETH },
    },
    dest: {
      protocol: 'morpho',
      market: MORPHO_MARKET,
      morpho: MORPHO_BLUE,
    },
    user: USER,
    settlement: SETTLEMENT,
    borrowAmount: 10_000_000_000_000_000_001n,
    conditions: [{
      lenderId: 4000,
      morpho: MORPHO_BLUE,
      // Market ID = keccak256 of the market params struct
      marketId: '0xb8fc70e82bc5bb53e773626fcc6a23f7eefa036918d7ef216ecfb1950a94a85e',
      minHealthFactor: 1_100_000_000_000_000_000n, // 1.1x
    }],
  })

  it('orderData includes settlement data with conditions', () => {
    const odLen = (result.orderData.length - 2) / 2
    // 32 (root) + 2 (sdLen) + settlement data
    // settlementData: 1 (numConversions=0) + 1 (numConditions=1) + 68 (morpho condition) = 70
    expect(odLen).toBe(34 + 70)
  })

  it('settlement data starts with 0 conversions', () => {
    // After root(32) + sdLen(2), first byte is numConversions
    const numConversions = parseInt(result.orderData.slice(70, 72), 16)
    expect(numConversions).toBe(0)
  })

  it('settlement data has 1 condition', () => {
    // numConditions is at byte 35 (32 root + 2 sdLen + 1 numConversions)
    const numConditions = parseInt(result.orderData.slice(72, 74), 16)
    expect(numConditions).toBe(1)
  })
})
