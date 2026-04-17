export interface RpcCall {
  jsonrpc: string
  id: number
  method: string
  params: [{ to: string; data: string }, string]
}

const RPC_URLS: Record<string, string[]> = {
  '1': [
    'https://eth.llamarpc.com',
    'https://rpc.ankr.com/eth',
  ],
  '10': [
    'https://mainnet.optimism.io',
    'https://rpc.ankr.com/optimism',
  ],
  '137': [
    'https://polygon-rpc.com',
    'https://rpc.ankr.com/polygon',
  ],
  '42161': [
    'https://arb1.arbitrum.io/rpc',
    'https://arbitrum-one-rpc.publicnode.com',
    'https://arb1.lava.build',
    'https://arbitrum.drpc.org',
    'https://arbitrum-one.public.blastapi.io',
    'https://arbitrum.meowrpc.com',
    'https://arbitrum-one-public.nodies.app',
    'https://arbitrum.gateway.tenderly.co',
    'https://arbitrum.public.blockpi.network/v1/rpc/public',
    'https://public-arb-mainnet.fastnode.io',
  ],
  '8453': [
    'https://mainnet.base.org',
    'https://base.drpc.org',
  ],
  '59144': [
    'https://rpc.linea.build',
  ],
  '534352': [
    'https://rpc.scroll.io',
  ],
  '5000': [
    'https://rpc.mantle.xyz',
  ],
  '56': [
    'https://bsc-dataseed.binance.org',
    'https://bsc-dataseed1.defibit.io',
  ],
}

/**
 * Execute a batch of eth_call RPCs with retry across multiple endpoints.
 * Tries each URL once; returns the first fully successful response.
 */
export async function executeRpcCallsWithRetry(
  chainId: string,
  rpcCalls: RpcCall[],
): Promise<unknown> {
  const urls = RPC_URLS[chainId]
  if (!urls || urls.length === 0) throw new Error(`No RPC URLs for chain ${chainId}`)

  const errors: string[] = []

  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rpcCalls),
        signal: AbortSignal.timeout(10_000),
      })
      if (!res.ok) {
        errors.push(`${url}: HTTP ${res.status}`)
        continue
      }
      const json = await res.json()
      if (Array.isArray(json)) {
        const hasError = json.some((r: { error?: unknown }) => r.error)
        if (hasError) {
          errors.push(`${url}: JSON-RPC error`)
          continue
        }
      } else if (json.error) {
        errors.push(`${url}: ${json.error.message ?? 'JSON-RPC error'}`)
        continue
      }
      return json
    } catch (e) {
      errors.push(`${url}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  throw new Error(`All RPCs failed for chain ${chainId}: ${errors.join(' | ')}`)
}
