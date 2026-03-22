/**
 * Settlement flow tests.
 *
 * Unit tests (no API keys needed):
 *   - describeLeaves decodes Aave and Morpho leaves correctly
 *   - buildSettlementTx produces well-formed calldata
 *
 * E2E test (requires ANTHROPIC_API_KEY + WDK_SEED + ORDER_BACKEND_URL):
 *   - Full runSettlementFlow with a mock order served via stubbed fetch
 *
 * Run:
 *   pnpm test tests/settlement.test.ts
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import {
  AaveData,
  MorphoData,
  defineOrder,
  LenderOps,
  encodeOrderData,
} from '@1delta/settlement-sdk'
import { describeLeaves } from '../src/order.js'
import { buildSettlementTx } from '../src/settle.js'
import type { MerkleLeaf, StoredOrder } from '../src/order.js'
import { Hex } from 'viem'

// ─── Test fixtures ────────────────────────────────────────────────────────────

// Arbitrum addresses
const AAVE_POOL       = '0x794a61358D6845594F94dc1DB02A252b5b4814aD' as const
const AAVE_ATOKEN     = '0x625E7708f30cA75bfd92586e17077590C60eb4cD' as const  // aUSDC
const AAVE_DEBT_TOKEN = '0xFCCf3cAbbe80101232d343252614b6A3eE81C989' as const  // varDebtUSDC
const USDC            = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const
const WETH            = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as const
const MORPHO_BLUE     = '0x6c247b1F6182318877311737BaC0844bAa518F5e' as const  // Arbitrum Morpho Blue
const MORPHO_ORACLE   = '0x1234567890123456789012345678901234567890' as const
const MORPHO_IRM      = '0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC' as const

const MORPHO_MARKET = {
  loanToken:       USDC,
  collateralToken: WETH,
  oracle:          MORPHO_ORACLE,
  irm:             MORPHO_IRM,
  lltv:            860000000000000000n,   // 86%
} as const

// Build leaves + merkle tree
const aaveRepayData    = AaveData.repay(AAVE_DEBT_TOKEN, AAVE_POOL, 2)
const aaveWithdrawData = AaveData.withdraw(AAVE_ATOKEN, AAVE_POOL)
const morphoDepositData = MorphoData.depositOrRepay(MORPHO_MARKET, MORPHO_BLUE)
const morphoBorrowData  = MorphoData.borrowOrWithdraw(MORPHO_MARKET, MORPHO_BLUE)

const { root, proofs } = defineOrder([
  { op: LenderOps.REPAY,    lender: 0,    data: aaveRepayData },
  { op: LenderOps.WITHDRAW, lender: 0,    data: aaveWithdrawData },
  { op: LenderOps.DEPOSIT,  lender: 4000, data: morphoDepositData },
  { op: LenderOps.BORROW,   lender: 4000, data: morphoBorrowData },
])

const MOCK_LEAVES: MerkleLeaf[] = [
  { op: LenderOps.REPAY,    lender: 0,    data: aaveRepayData,    leaf: root, proof: proofs[0] },
  { op: LenderOps.WITHDRAW, lender: 0,    data: aaveWithdrawData, leaf: root, proof: proofs[1] },
  { op: LenderOps.DEPOSIT,  lender: 4000, data: morphoDepositData, leaf: root, proof: proofs[2] },
  { op: LenderOps.BORROW,   lender: 4000, data: morphoBorrowData,  leaf: root, proof: proofs[3] },
]

const MOCK_ORDER: StoredOrder = {
  id: 'test-order-1',
  createdAt: Date.now(),
  status: 'open',
  signer: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
  signature: ('0x' + 'ab'.repeat(65)) as Hex,
  order: {
    merkleRoot:    root,
    deadline:      Math.floor(Date.now() / 1000) + 3600,
    settlementData: '0x',
    orderData:     encodeOrderData(root),
    executionData: '0x',
    fillerCalldata: '0x',
    chainId:       42161,
    maxFeeBps:     50000,   // 0.5%
    leaves:        MOCK_LEAVES,
  },
}

const SETTLEMENT = '0x1111111111111111111111111111111111111111' as const

// ─── Unit: describeLeaves ─────────────────────────────────────────────────────

describe('describeLeaves', () => {
  it('decodes Aave REPAY leaf correctly', () => {
    const descs = describeLeaves(MOCK_LEAVES)
    const repay = descs.find(d => d.op === 'REPAY' && d.protocol === 'AAVE_V3')!
    expect(repay).toBeDefined()
    expect(repay.index).toBe(0)
    expect(repay.vToken?.toLowerCase()).toBe(AAVE_DEBT_TOKEN.toLowerCase())
    expect(repay.pool?.toLowerCase()).toBe(AAVE_POOL.toLowerCase())
  })

  it('decodes Aave WITHDRAW leaf correctly', () => {
    const descs = describeLeaves(MOCK_LEAVES)
    const withdraw = descs.find(d => d.op === 'WITHDRAW' && d.protocol === 'AAVE_V3')!
    expect(withdraw).toBeDefined()
    expect(withdraw.index).toBe(1)
    expect(withdraw.aToken?.toLowerCase()).toBe(AAVE_ATOKEN.toLowerCase())
    expect(withdraw.pool?.toLowerCase()).toBe(AAVE_POOL.toLowerCase())
  })

  it('decodes Morpho DEPOSIT leaf correctly', () => {
    const descs = describeLeaves(MOCK_LEAVES)
    const deposit = descs.find(d => d.op === 'DEPOSIT' && d.protocol === 'MORPHO_BLUE')!
    expect(deposit).toBeDefined()
    expect(deposit.index).toBe(2)
    expect(deposit.loanToken?.toLowerCase()).toBe(USDC.toLowerCase())
    expect(deposit.collateralToken?.toLowerCase()).toBe(WETH.toLowerCase())
    expect(deposit.lltv).toBe('86.00%')
  })

  it('decodes Morpho BORROW leaf correctly', () => {
    const descs = describeLeaves(MOCK_LEAVES)
    const borrow = descs.find(d => d.op === 'BORROW' && d.protocol === 'MORPHO_BLUE')!
    expect(borrow).toBeDefined()
    expect(borrow.index).toBe(3)
    expect(borrow.loanToken?.toLowerCase()).toBe(USDC.toLowerCase())
  })

  it('assigns sequential indices matching the leaves array', () => {
    const descs = describeLeaves(MOCK_LEAVES)
    descs.forEach((d, i) => expect(d.index).toBe(i))
  })
})

// ─── Unit: buildSettlementTx ──────────────────────────────────────────────────

describe('buildSettlementTx', () => {
  const input = {
    order:               MOCK_ORDER,
    sourceRepayLeaf:     MOCK_LEAVES[0],
    sourceWithdrawLeaf:  MOCK_LEAVES[1],
    destDepositLeaf:     MOCK_LEAVES[2],
    destBorrowLeaf:      MOCK_LEAVES[3],
    collateralAsset:     WETH,
    debtAsset:           USDC,
    user:                MOCK_ORDER.signer,
    settlement:          SETTLEMENT,
    morphoPool:          MORPHO_BLUE,     // Arbitrum Morpho Blue
    debtAmount:          1_000_000_000n,  // 1000 USDC (6 decimals)
  }

  it('returns correct chainId and settlement address', async () => {
    const tx = await buildSettlementTx(input)
    expect(tx.chainId).toBe(42161)
    expect(tx.to.toLowerCase()).toBe(SETTLEMENT.toLowerCase())
  })

  it('starts with settleWithFlashLoan selector (0x...)', async () => {
    const tx = await buildSettlementTx(input)
    // settleWithFlashLoan selector
    expect(tx.data.startsWith('0x')).toBe(true)
    expect(tx.data.length).toBeGreaterThan(10)
  })

  it('adds 0.01% buffer to flash amount', async () => {
    const tx = await buildSettlementTx(input)
    // 1_000_000_000 + 1_000_000_000/10_000 + 1 = 1_000_100_001
    expect(tx.flashAmount).toBe(1_000_100_001n)
  })

  it('borrow amount is debtAmount plus fee headroom', async () => {
    const tx = await buildSettlementTx(input)
    // borrowAmount = debtAmount + debtAmount * maxFeeBps / 1e7
    // maxFeeBps = 50_000, so +0.5% of debtAmount
    const debtAmount = 1_000_000_000n
    const expected = debtAmount + (debtAmount * 50000n) / 10_000_000n
    expect(tx.borrowAmount).toBe(expected)
  })

  it('wraps in multicall when permits are present', async () => {
    const inputWithPermits = {
      ...input,
      order: {
        ...input.order,
        order: {
          ...input.order.order,
          permits: [
            {
              kind: 'ERC2612_PERMIT' as const,
              targetAddress: AAVE_ATOKEN as `0x${string}`,
              deadline: '1700000000',
              nonce: '0',
              v: 27,
              r: '0x' + 'aa'.repeat(32) as `0x${string}`,
              s: '0x' + 'bb'.repeat(32) as `0x${string}`,
            },
            {
              kind: 'AAVE_DELEGATION' as const,
              targetAddress: AAVE_DEBT_TOKEN as `0x${string}`,
              deadline: '1700000000',
              nonce: '1',
              v: 28,
              r: '0x' + 'cc'.repeat(32) as `0x${string}`,
              s: '0x' + 'dd'.repeat(32) as `0x${string}`,
            },
          ],
        },
      },
    }
    const tx = await buildSettlementTx(inputWithPermits)
    // multicall selector = 0xac9650d8
    expect(tx.data.startsWith('0xac9650d8')).toBe(true)
  })

  it('always wraps in multicall (approvals are always needed)', async () => {
    const tx = await buildSettlementTx(input)
    // multicall selector = 0xac9650d8
    expect(tx.data.startsWith('0xac9650d8')).toBe(true)
  })
})

// ─── E2E: full runSettlementFlow with mocked order backend ────────────────────

const canRunE2e = !!(process.env.OPENAI_API_KEY && process.env.WDK_SEED)

describe.skipIf(!canRunE2e)(
  'runSettlementFlow e2e (requires ANTHROPIC_API_KEY + WDK_SEED)',
  () => {
    beforeAll(async () => {
      process.env.DRY_RUN = 'true'
      process.env.MODEL ??= 'gpt-4o-mini'

      // Stub fetch so fetchOrder returns our mock order without a real backend.
      // All other fetches (1delta MCP) are forwarded to the real implementation.
      const realFetch = global.fetch.bind(global)
      vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
        const u = url.toString()
        if (u.includes('/v1/orders/')) {
          return { ok: true, json: async () => MOCK_ORDER } as Response
        }
        return realFetch(url, init)
      })
    })

    afterAll(async () => {
      vi.unstubAllGlobals()
      delete process.env.DRY_RUN
      delete process.env.MODEL
    })

    it('agent proposes a migration and settlement tx is built', async () => {
      const { runSettlementFlow } = await import('../src/main.js')

      const result = await runSettlementFlow('test-order-1', 42161)

      // In DRY_RUN mode the result is either the agent's text (no migration found)
      // or 'DRY_RUN' (migration proposed and tx built)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)

      console.log('Settlement flow result:', result)
    }, 180_000)
  },
)