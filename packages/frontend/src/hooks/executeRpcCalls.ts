// Descriptor shape returned by the backend
interface RpcCallDescriptor {
  chainId: string
  call: { to: string; data: string } | JsonRpcCall
}

interface JsonRpcCall {
  jsonrpc: '2.0'
  id: number
  method: 'eth_call'
  params: unknown[]
}

export type RpcCall = RpcCallDescriptor | JsonRpcCall

export interface RawRpcResponse {
  chainId: string
  result: string
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

function getRpcUrlByIndex(chainId: string, index: number): string {
  const urls = RPC_URLS[chainId]
  if (!urls || urls.length === 0) throw new Error(`No RPC URLs for chain ${chainId}`)
  return urls[index % urls.length]
}

function isJsonRpcCall(obj: unknown): obj is JsonRpcCall {
  return !!obj
    && typeof obj === 'object'
    && 'method' in obj
    && (obj as { method?: unknown }).method === 'eth_call'
}

/**
 * Resolve the RPC body from whatever format the backend returns:
 *  - Pure JSON-RPC: { jsonrpc, id, method, params }              → send as-is
 *  - Descriptor w/ JSON-RPC call: { chainId, call: {jsonrpc…} }  → unwrap .call
 *  - Descriptor w/ plain call:    { chainId, call: {to, data} }  → wrap in eth_call
 */
function toRpcBody(call: RpcCall): object {
  if (isJsonRpcCall(call)) return call
  if (isJsonRpcCall(call.call)) return call.call
  return { jsonrpc: '2.0', id: 1, method: 'eth_call', params: [call.call, 'latest'] }
}

async function executeCall(
  rpcUrl: string,
  call: RpcCall,
  chainId: string,
  maxRetries = 3,
  initialDelayMs = 1000,
): Promise<RawRpcResponse> {
  let lastError: Error | null = null

  const body = toRpcBody(call)
  const responseChainId = isJsonRpcCall(call) ? chainId : call.chainId

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (response.status === 429 || response.status >= 500) {
        const delayMs = initialDelayMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }

      if (!response.ok) {
        throw new Error(`RPC call failed: ${response.statusText}`)
      }

      const result = await response.json() as { result?: string; error?: { message: string } }
      if (result.error) {
        throw new Error(`RPC error: ${result.error.message}`)
      }
      return { chainId: responseChainId, result: result.result ?? '' }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))

      if (attempt < maxRetries) {
        const delayMs = initialDelayMs * Math.pow(2, attempt)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }
  }

  throw lastError ?? new Error('RPC call failed after all retries')
}

/**
 * Execute each RPC call individually against a per-chain URL pool.
 * On failure, rotates to the next URL and retries the whole batch.
 * Returns [{ chainId, result }] — the flat shape the parse endpoint expects.
 */
export async function executeRpcCallsWithRetry(
  chainId: string,
  rpcCalls: RpcCall[],
  maxRetries = 5,
  initialDelayMs = 1000,
): Promise<RawRpcResponse[]> {
  let lastError: Error | null = null

  for (let i = 0; i < maxRetries; i++) {
    try {
      const rpcUrl = getRpcUrlByIndex(chainId, i)
      return await Promise.all(
        rpcCalls.map(call => executeCall(rpcUrl, call, chainId, 1, initialDelayMs)),
      )
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
    }
  }

  throw lastError ?? new Error(`Failed to execute RPC calls for chain ${chainId} after ${maxRetries} attempts`)
}
