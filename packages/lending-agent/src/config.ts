export const ONEDELTA_MCP_URL = 'https://mcp-prototype.1delta.io/mcp'

export const CHAIN_FILTER: string = process.env.CHAIN_FILTER ?? ''
export const DRY_RUN: boolean = process.env.DRY_RUN === 'true'

/**
 * When true, the agent skips settlements where estimated gas cost exceeds
 * the solver fee allowed by the order's maxFeeBps. Disable with ECONOMIC_MODE=false.
 */
export const ECONOMIC_MODE: boolean = process.env.ECONOMIC_MODE !== 'false'

// Cap tool results to keep context window manageable
export const RESULT_CHAR_LIMIT = 20000

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

export const RPC_URL_BY_CHAIN: Record<number, string> = {
  42161: 'https://arb1.arbitrum.io/rpc',
}

/**
 * Compound V3 comet address → lender name mapping, keyed by chainId.
 * Source: packages/frontend/src/data/lenders.ts (COMPOUND_V3_POOLS)
 * Used to resolve the exact lender name (e.g. "COMPOUND_V3_USDT") from a comet address
 * so we can match against marketUid in the lending markets API.
 */
export const COMPOUND_V3_COMET_TO_LENDER: Record<number, Record<string, string>> = {
  42161: {
    '0x9c4ec768c28520b50860ea7a15bd7213a9ff58bf': 'COMPOUND_V3_USDC',
    '0xa5edbdd9646f8dff606d7448e414884c7d905dca': 'COMPOUND_V3_USDCE',
    '0xd98be00b5d27fc98112bde293e487f8d4ca57d07': 'COMPOUND_V3_USDT',
    '0x6f7d514bbd4aff3bcd1140b7344b32f063dee486': 'COMPOUND_V3_WETH',
  },
}

/** Resolve a Compound V3 comet address to its lender name (lowercase comet address). */
export function cometToLender(comet: string, chainId: number): string | null {
  return COMPOUND_V3_COMET_TO_LENDER[chainId]?.[comet.toLowerCase()] ?? null
}

export const CHAIN_NAMES: Record<number, string> = {
  1:     'ethereum',
  42161: 'arbitrum',
  8453:  'base',
}