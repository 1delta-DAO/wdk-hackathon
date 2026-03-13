/**
 * 1delta × WDK Lending Agent
 *
 * Finds the best lending market via 1delta MCP and executes a deposit via WDK MCP.
 */

import { main } from './src/main.js'

main().catch(err => {
  console.error('Fatal:', err instanceof Error ? err.message : err)
  process.exit(1)
})
