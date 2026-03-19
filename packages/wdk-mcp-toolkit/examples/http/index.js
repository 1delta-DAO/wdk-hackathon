'use strict'

/**
 * WDK MCP HTTP server.
 *
 * Same capabilities as examples/basic/index.js but exposed over HTTP using
 * StreamableHTTPServerTransport instead of stdio. This lets the lending-agent
 * Cloudflare Worker connect via WDK_MCP_URL rather than spawning a child process.
 *
 * Usage:
 *   WDK_SEED=<seed> WDK_MCP_PORT=4001 node examples/http/index.js
 *
 * The lending-agent worker needs:
 *   WDK_MCP_URL=http://<host>:4001/mcp
 */

import { createServer } from 'node:http'
import { randomUUID } from 'node:crypto'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import WalletManagerBtc from '@tetherto/wdk-wallet-btc'
import WalletManagerEvm from '@tetherto/wdk-wallet-evm'
import VeloraProtocolEvm from '@tetherto/wdk-protocol-swap-velora-evm'
import Usdt0ProtocolEvm from '@tetherto/wdk-protocol-bridge-usdt0-evm'
import AaveProtocolEvm from '@tetherto/wdk-protocol-lending-aave-evm'
import MoonPayProtocol from '@tetherto/wdk-protocol-fiat-moonpay'
import { WdkMcpServer } from '../../src/server.js'
import { WALLET_TOOLS } from '../../src/tools/wallet/index.js'
import { PRICING_TOOLS } from '../../src/tools/pricing/index.js'
import { INDEXER_TOOLS } from '../../src/tools/indexer/index.js'
import { SWAP_TOOLS } from '../../src/tools/swap/index.js'
import { BRIDGE_TOOLS } from '../../src/tools/bridge/index.js'
import { LENDING_TOOLS } from '../../src/tools/lending/index.js'
import { FIAT_TOOLS } from '../../src/tools/fiat/index.js'

const PORT = Number(process.env.WDK_MCP_PORT ?? 4001)
const HAS_INDEXER = !!process.env.WDK_INDEXER_API_KEY
const HAS_FIAT = process.env.MOONPAY_API_KEY && process.env.MOONPAY_SECRET_KEY

// Sessions: sessionId → StreamableHTTPServerTransport
const sessions = new Map()

// Idle session cleanup — remove sessions inactive for >10 minutes
const SESSION_TTL_MS = 10 * 60 * 1000
const sessionLastSeen = new Map()
setInterval(() => {
  const now = Date.now()
  for (const [id, ts] of sessionLastSeen) {
    if (now - ts > SESSION_TTL_MS) {
      sessions.get(id)?.close().catch(() => {})
      sessions.delete(id)
      sessionLastSeen.delete(id)
    }
  }
}, 60_000)

function createWdkServer () {
  const server = new WdkMcpServer('wdk-mcp-server', '1.0.0')
    .useWdk({ seed: process.env.WDK_SEED })
    .registerWallet('ethereum', WalletManagerEvm, {
      provider: 'https://rpc.mevblocker.io/fast'
    })
    .registerWallet('arbitrum', WalletManagerEvm, {
      provider: 'https://arb1.arbitrum.io/rpc'
    })
    .registerWallet('bitcoin', WalletManagerBtc, {
      network: 'bitcoin'
    })
    .registerProtocol('ethereum', 'velora', VeloraProtocolEvm)
    .registerProtocol('arbitrum', 'velora', VeloraProtocolEvm)
    .registerProtocol('ethereum', 'usdt0', Usdt0ProtocolEvm)
    .registerProtocol('arbitrum', 'usdt0', Usdt0ProtocolEvm)
    .registerProtocol('ethereum', 'aave', AaveProtocolEvm)
    .usePricing()

  if (HAS_INDEXER) {
    server.useIndexer({ apiKey: process.env.WDK_INDEXER_API_KEY })
  }

  if (HAS_FIAT) {
    server.registerProtocol('ethereum', 'moonpay', MoonPayProtocol, {
      secretKey: process.env.MOONPAY_SECRET_KEY,
      apiKey: process.env.MOONPAY_API_KEY
    })
  }

  const tools = [
    ...WALLET_TOOLS,
    ...PRICING_TOOLS,
    ...SWAP_TOOLS,
    ...BRIDGE_TOOLS,
    ...LENDING_TOOLS
  ]
  if (HAS_INDEXER) tools.push(...INDEXER_TOOLS)
  if (HAS_FIAT) tools.push(...FIAT_TOOLS)
  server.registerTools(tools)

  return server
}

async function main () {
  if (!process.env.WDK_SEED) {
    console.error('Error: WDK_SEED environment variable is required.')
    process.exit(1)
  }

  const httpServer = createServer(async (req, res) => {
    // Health check
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok', sessions: sessions.size }))
      return
    }

    if (req.url !== '/mcp') {
      res.writeHead(404)
      res.end()
      return
    }

    // Collect body for POST requests
    let body
    if (req.method === 'POST') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      try { body = JSON.parse(Buffer.concat(chunks).toString()) } catch { body = undefined }
    }

    const sessionId = req.headers['mcp-session-id']

    if (sessionId && sessions.has(sessionId)) {
      // Existing session
      sessionLastSeen.set(sessionId, Date.now())
      await sessions.get(sessionId).handleRequest(req, res, body)
      return
    }

    if (req.method === 'DELETE' && sessionId) {
      // Client explicitly closing a session that's already gone
      res.writeHead(200)
      res.end()
      return
    }

    // New session — must be an initialize POST
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, transport)
        sessionLastSeen.set(id, Date.now())
      },
      onsessionclosed: (id) => {
        sessions.delete(id)
        sessionLastSeen.delete(id)
      },
      enableJsonResponse: false,
    })

    const wdkServer = createWdkServer()
    await wdkServer.connect(transport)
    await transport.handleRequest(req, res, body)
  })

  httpServer.listen(PORT, () => {
    console.log(`WDK MCP HTTP server listening on http://0.0.0.0:${PORT}/mcp`)
    console.log('Set WDK_MCP_URL=http://<host>:' + PORT + '/mcp in the lending-agent worker.')
  })
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
