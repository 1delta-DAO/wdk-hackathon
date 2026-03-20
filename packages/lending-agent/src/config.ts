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
    settlement: '0x2FA48F02923a0C93326A68aA26E3a0b836d5685F',
    forwarder:  '0x42fe151e9d49995927784a91595ce5C243F26D5a',
    aaveOracle: '0x2E837679425d8B32cCDc4448ddC222930Ef6ED96',
  },
}

