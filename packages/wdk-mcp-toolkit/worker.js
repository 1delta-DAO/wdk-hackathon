/**
 * WDK MCP Cloudflare Worker.
 *
 * Exposes the WDK wallet as an MCP server over HTTP using stateless
 * StreamableHTTPServerTransport — each POST /mcp request creates a fresh
 * WdkMcpServer instance, handles the MCP call, and responds. No session
 * state is needed because wallet operations (getAddress, sendTransaction)
 * only require the seed from the environment.
 *
 * The lending-agent worker sets WDK_MCP_URL to this worker's URL.
 *
 * Required secrets (wrangler secret put):
 *   WDK_SEED   — BIP-39 seed phrase for the solver wallet
 *
 * Deploy:
 *   wrangler deploy worker.js --config wrangler.toml
 */

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import { WdkMcpServer } from './src/server.js'
import { WALLET_TOOLS } from './src/tools/wallet/index.js'

function createServer (seed) {
  const server = new WdkMcpServer('wdk-mcp-server', '1.0.0')
    .useWdk({ seed })
    .registerWallet('ethereum', WalletManagerEvm, {
      provider: 'https://rpc.mevblocker.io/fast'
    })
    .registerWallet('arbitrum', WalletManagerEvm, {
      provider: 'https://arb1.arbitrum.io/rpc'
    })
    .registerTools(WALLET_TOOLS)

  return server
}

export default {
  async fetch (request, env) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    if (new URL(request.url).pathname !== '/mcp') {
      return new Response('Not found', { status: 404 })
    }

    const seed = env.WDK_SEED
    if (!seed) {
      return Response.json({ error: 'WDK_SEED is not configured' }, { status: 500 })
    }

    // Stateless mode: no session tracking — each request is self-contained
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    })

    const wdkServer = createServer(seed)
    await wdkServer.connect(transport)

    let body
    if (request.method === 'POST') {
      try { body = await request.json() } catch { /* ok */ }
    }

    // Convert the web Request to Node-compatible shape expected by handleRequest
    const { IncomingMessage, ServerResponse } = await import('node:http')
    const nodeReq = Object.assign(Object.create(IncomingMessage.prototype), {
      method: request.method,
      url: new URL(request.url).pathname,
      headers: Object.fromEntries(request.headers.entries()),
    })

    return new Promise((resolve) => {
      const chunks = []
      const nodeRes = Object.assign(Object.create(ServerResponse.prototype), {
        statusCode: 200,
        headers: {},
        setHeader (name, value) { this.headers[name] = value },
        getHeader (name) { return this.headers[name] },
        write (chunk) { chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk) },
        end (chunk) {
          if (chunk) chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
          resolve(new Response(Buffer.concat(chunks), {
            status: this.statusCode,
            headers: this.headers,
          }))
        },
      })

      transport.handleRequest(nodeReq, nodeRes, body).catch((err) => {
        resolve(Response.json({ error: err.message }, { status: 500 }))
      })
    })
  },
}
