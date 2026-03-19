import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export const ONEDELTA_MCP_URL = 'https://mcp-prototype.1delta.io/mcp'
export const WDK_SERVER_PATH = join(__dirname, '../../wdk-mcp-toolkit/examples/basic/index.js')

export const TOKEN: string = process.env.TOKEN ?? 'USDT'
export const AMOUNT: string = process.env.AMOUNT ?? '1'
export const CHAIN_FILTER: string = process.env.CHAIN_FILTER ?? ''
export const DRY_RUN: boolean = process.env.DRY_RUN === 'true'
export const SETTLEMENT_ADDRESS: string = process.env.SETTLEMENT_ADDRESS ?? ''

// Cap tool results to ~1500 tokens to keep context window manageable
export const RESULT_CHAR_LIMIT = 6000
