export const ONEDELTA_MCP_URL = 'https://mcp-prototype.1delta.io/mcp'

export const CHAIN_FILTER: string = process.env.CHAIN_FILTER ?? ''
export const DRY_RUN: boolean = process.env.DRY_RUN === 'true'

// Cap tool results to ~1500 tokens to keep context window manageable
export const RESULT_CHAR_LIMIT = 6000

export const CONTRACTS_BY_CHAIN: Record<number, {
  settlement: `0x${string}`
  forwarder:  `0x${string}`
  aaveOracle: `0x${string}`
}> = {
  // Arbitrum One
  42161: {
    settlement: '0x62002C215BF3c7a1FD1f794a8e664CF5dc4F3Da2',
    forwarder:  '0xaD56e62B148cbff3A45bDc2a0dD423c4B4a1b98a',
    aaveOracle: '0x4b20b77aaCe3F0BD3Be3957CD15837FfEA2a1925',
  },
}

