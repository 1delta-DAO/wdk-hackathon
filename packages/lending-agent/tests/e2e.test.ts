/**
 * End-to-end test for the full lending agent.
 *
 * - Real 1delta MCP  (public endpoint, no key needed)
 * - Real Claude API  (requires ANTHROPIC_API_KEY env var)
 * - Real WDK MCP     (requires WDK_SEED env var, DRY_RUN prevents tx submission)
 *
 * Run with:
 *   ANTHROPIC_API_KEY=sk-ant-... WDK_SEED="word1 word2 ..." pnpm test tests/e2e.test.ts
 *
 * Skipped automatically when ANTHROPIC_API_KEY or WDK_SEED is absent.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { connectOneDelta, connectWdk } from '../src/mcp.js'
import { runAgent } from '../src/main.js'

const TIMEOUT = 120_000 // agent may need many tool-call turns

const canRun = !!(process.env.ANTHROPIC_API_KEY && process.env.WDK_SEED)

describe.skipIf(!canRun)(
  'lending agent — e2e (requires ANTHROPIC_API_KEY + WDK_SEED)',
  () => {
    let oneDeltaClient: Client
    let wdkClient: Client

    beforeAll(async () => {
      // Force DRY_RUN so the agent never calls sendTransaction
      process.env.DRY_RUN = 'true'
      process.env.TOKEN = 'USDT'
      process.env.AMOUNT = '1'
      process.env.CHAIN_FILTER = '42161' // Arbitrum only — fewer market fetches
      process.env.MODEL ??= 'claude-haiku-4-5' // use fast/cheap model unless overridden

      ;[oneDeltaClient, wdkClient] = await Promise.all([
        connectOneDelta(),
        connectWdk()
      ])
    }, TIMEOUT)

    afterAll(async () => {
      await Promise.allSettled([oneDeltaClient.close(), wdkClient.close()])
      delete process.env.DRY_RUN
      delete process.env.TOKEN
      delete process.env.AMOUNT
      delete process.env.CHAIN_FILTER
      delete process.env.MODEL
    })

    it('finds the best USDC market on Arbitrum and produces deposit calldata', async () => {
      const result = await runAgent({ oneDeltaClient, wdkClient })

      // Agent should have produced a non-empty text response
      expect(result.length).toBeGreaterThan(0)

      // The response should reference a lending protocol (one of the major ones on Arbitrum)
      const mentionsProtocol = /aave|compound|morpho|radiant|silo|euler|moonwell|tender|init/i.test(result)
      expect(mentionsProtocol, 'expected agent to mention a lending protocol').toBe(true)

      // Should mention a deposit rate / APR figure
      const mentionsRate = /\d+(\.\d+)?%|apr|apy|deposit\s*rate/i.test(result)
      expect(mentionsRate, 'expected agent to report a deposit rate').toBe(true)
    }, TIMEOUT)
  }
)
