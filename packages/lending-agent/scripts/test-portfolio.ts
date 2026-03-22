/**
 * Standalone test script for the portfolio management agent.
 *
 * Usage (with DRY_RUN to only see reasoning, no real txs):
 *
 *   DRY_RUN=true node --env-file=.env --loader ts-node/esm scripts/test-portfolio.ts
 *
 * Or compile first and run via Node:
 *
 *   pnpm build && DRY_RUN=true node --env-file=.env dist/scripts/test-portfolio.js
 *
 * Requires .env with at minimum:
 *   OPENAI_API_KEY or ANTHROPIC_API_KEY
 *   WDK_SEED
 *   DRY_RUN=true   (set to false to actually submit txs)
 */

import { runPortfolioManagement } from '../src/portfolioAgent.js'

const CHAIN_ID = 42161 // Arbitrum One

console.log('=== Portfolio Agent Test ===')
console.log(`Chain: ${CHAIN_ID} (Arbitrum One)`)
console.log(`DRY_RUN: ${process.env.DRY_RUN ?? 'false (set DRY_RUN=true to skip execution)'}`)
console.log('')

runPortfolioManagement(CHAIN_ID).then(() => {
  console.log('\nDone.')
  process.exit(0)
}).catch(err => {
  console.error('\nFATAL:', err)
  process.exit(1)
})
