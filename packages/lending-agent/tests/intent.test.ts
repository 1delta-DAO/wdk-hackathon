/**
 * Intent-based lending agent test.
 *
 * Validates that the agent correctly interprets a LendingIntent order object:
 *   - Only considers the allowed lenders specified in the intent
 *   - Operates on the correct chain
 *   - Targets the correct collateral and debt tokens (by address)
 *   - Produces deposit/borrow calldata
 *
 * Requires ANTHROPIC_API_KEY + WDK_SEED to run.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-ant-... WDK_SEED="word1 word2 ..." pnpm test tests/intent.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { connectOneDelta, connectWdk } from '../src/mcp.js'
import { runAgentWithIntent, type LendingIntent } from '../src/main.js'

const TIMEOUT = 120_000

const canRun = !!(process.env.ANTHROPIC_API_KEY && process.env.WDK_SEED)

// Arbitrum mainnet addresses
const ARBITRUM_CHAIN_ID = 42161
const USDC_ARBITRUM = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'
const USDT_ARBITRUM = '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'

describe.skipIf(!canRun)(
  'lending agent — intent-based e2e (requires ANTHROPIC_API_KEY + WDK_SEED)',
  () => {
    let oneDeltaClient: Client
    let wdkClient: Client

    beforeAll(async () => {
      process.env.DRY_RUN = 'true'
      process.env.MODEL ??= 'claude-haiku-4-5'

      ;[oneDeltaClient, wdkClient] = await Promise.all([
        connectOneDelta(),
        connectWdk()
      ])
    }, TIMEOUT)

    afterAll(async () => {
      await Promise.allSettled([oneDeltaClient.close(), wdkClient.close()])
      delete process.env.DRY_RUN
      delete process.env.MODEL
    })

    it('respects allowed lenders and optimizes collateral/debt position on Arbitrum', async () => {
      const intent: LendingIntent = {
        // User's EIP-712 signature over this order — validated onchain by the intent contract
        signature: '0xdeadbeef', // placeholder; agent does not submit txs in DRY_RUN

        chainId: ARBITRUM_CHAIN_ID,

        // Token addresses on the target chain
        collateralToken: USDC_ARBITRUM, // supplying USDC as collateral
        debtToken: USDT_ARBITRUM,       // borrowing USDT

        // Only consider these lenders — must use exact 1delta lender IDs
        allowedLenders: ['AAVE_V3', 'COMPOUND_V3', 'TENDER'],

        // USD amount to deposit as collateral
        usdAmount: '10',
      }

      // Spy on 1delta tool calls to verify the agent inspects positions before optimizing
      const calledOneDeltaTools: string[] = []
      const originalCallTool = oneDeltaClient.callTool.bind(oneDeltaClient)
      oneDeltaClient.callTool = async (params, ...rest) => {
        calledOneDeltaTools.push(params.name)
        return originalCallTool(params, ...rest)
      }

      const result = await runAgentWithIntent({ oneDeltaClient, wdkClient }, intent)

      // Agent must have fetched existing positions before doing anything else
      expect(
        calledOneDeltaTools.includes('get_user_positions'),
        'agent must call get_user_positions to inspect existing positions'
      ).toBe(true)

      // get_user_positions must be the first 1delta tool called
      expect(
        calledOneDeltaTools[0],
        'get_user_positions must be called before market discovery'
      ).toBe('get_user_positions')

      // Agent must produce a non-empty response
      expect(result.length).toBeGreaterThan(0)

      // Agent must have selected one of the allowed lenders
      const usedAllowedLender = /aave|compound|tender/i.test(result)
      expect(usedAllowedLender, 'agent must select one of the allowed lenders').toBe(true)

      // Agent must reference Arbitrum
      const mentionsChain = /arbitrum|42161/i.test(result)
      expect(mentionsChain, 'agent must reference the target chain').toBe(true)

      // Agent must report a rate
      const mentionsRate = /\d+(\.\d+)?%|apr|apy|deposit\s*rate/i.test(result)
      expect(mentionsRate, 'agent must report a deposit rate').toBe(true)

      // Agent must produce calldata (hex-encoded transaction data)
      const hasCalldata = /0x[0-9a-f]{8,}/i.test(result)
      expect(hasCalldata, 'agent must produce transaction calldata').toBe(true)
    }, TIMEOUT)

    it('rejects an intent with no matching markets for the allowed lenders', async () => {
      const intent: LendingIntent = {
        signature: '0xdeadbeef',
        chainId: ARBITRUM_CHAIN_ID,
        collateralToken: USDC_ARBITRUM,
        debtToken: USDT_ARBITRUM,
        // Deliberately use a lender unlikely to have USDC/USDT markets on Arbitrum
        allowedLenders: ['NONEXISTENT_LENDER'],
        usdAmount: '10',
      }

      const result = await runAgentWithIntent({ oneDeltaClient, wdkClient }, intent)

      // Agent should report that no markets were found rather than hallucinating one
      const reportsNoMarket = /no market|not found|no result|unavailable|cannot find|does not exist|cannot proceed|not exist|invalid lender|no valid/i.test(result)
      expect(reportsNoMarket, 'agent must report no markets found instead of hallucinating').toBe(true)
    }, TIMEOUT)
  }
)
