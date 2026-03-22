/**
 * Node.js HTTP server entry point — mirrors the Cloudflare Worker routes in worker.ts.
 *
 * Routes:
 *   GET  /health         — liveness check
 *   GET  /address        — agent wallet address (public)
 *   POST /settle/all     — run settlement for all open orders (Bearer-protected)
 *                          body: { chainId: number }
 *
 * Cron: runs the settlement loop every hour via setInterval.
 *
 * Environment variables (set in .env):
 *   ANTHROPIC_API_KEY, WDK_SEED, ORDER_BACKEND_URL, API_SECRET,
 *   ONEDELTA_API_KEY (optional), MODEL (optional), DRY_RUN (optional),
 *   CRON_CHAIN_IDS (optional, comma-separated, default "42161"),
 *   PORT (optional, default 3000)
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { runAllSettlements, runSettlementFlow } from './src/main.js'
import { getWdkAddress } from './src/wdk.js'
import { RPC_URL_BY_CHAIN } from './src/config.js'

const PORT = Number(process.env.PORT ?? 3000)
const API_SECRET = process.env.API_SECRET ?? ''
const CRON_CHAIN_IDS = (process.env.CRON_CHAIN_IDS ?? '42161')
  .split(',').map(s => Number(s.trim())).filter(Boolean)

// ── Auth ──────────────────────────────────────────────────────────────────────

function bearerOk (req: IncomingMessage): boolean {
  const auth = req.headers['authorization'] ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return !!API_SECRET && token === API_SECRET
}

// ── Response helpers ──────────────────────────────────────────────────────────

function json (res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(payload)
}

async function readBody (req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c))
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString())) }
      catch { resolve({}) }
    })
  })
}

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  // GET /health
  if (req.method === 'GET' && url.pathname === '/health') {
    return json(res, 200, { status: 'ok' })
  }

  // GET /address
  if (req.method === 'GET' && url.pathname === '/address') {
    const rpcUrl = RPC_URL_BY_CHAIN[42161]
    const address = await getWdkAddress(process.env.WDK_SEED ?? '', rpcUrl)
    return json(res, 200, { address })
  }

  // POST /settle/all  (Bearer-protected)
  // body: { chainId: number, forceMigration?: boolean }
  if (req.method === 'POST' && url.pathname === '/settle/all') {
    if (!bearerOk(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' })
      return res.end(JSON.stringify({ error: 'Unauthorized' }))
    }

    const body = await readBody(req)
    const chainId = Number(body.chainId)
    if (!chainId) return json(res, 400, { error: 'chainId required' })
    const forceMigration = body.forceMigration === true

    const results = await runAllSettlements(chainId, forceMigration)
    return json(res, 200, { results })
  }

  // POST /settle/order  (Bearer-protected)
  // body: { orderId: string, chainId: number, forceMigration?: boolean }
  if (req.method === 'POST' && url.pathname === '/settle/order') {
    if (!bearerOk(req)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer' })
      return res.end(JSON.stringify({ error: 'Unauthorized' }))
    }

    const body = await readBody(req)
    const orderId = String(body.orderId ?? '')
    const chainId = Number(body.chainId)
    if (!orderId) return json(res, 400, { error: 'orderId required' })
    if (!chainId) return json(res, 400, { error: 'chainId required' })
    const forceMigration = body.forceMigration === true

    const result = await runSettlementFlow(orderId, chainId, forceMigration)
    return json(res, 200, { orderId, result })
  }

  json(res, 404, { error: 'Not found' })
})

server.listen(PORT, () => {
  console.log(`lending-agent HTTP server listening on http://localhost:${PORT}`)
})

// ── Hourly cron ───────────────────────────────────────────────────────────────

async function cronJob () {
  console.log(`[cron] Starting hourly settlement run for chains: ${CRON_CHAIN_IDS.join(', ')}`)
  for (const chainId of CRON_CHAIN_IDS) {
    console.log(`[cron] Processing chain ${chainId}…`)
    try {
      const results = await runAllSettlements(chainId)
      const settled = results.filter((r: { result: string }) => !r.result.startsWith('ERROR') && r.result !== 'DRY_RUN')
      const skipped = results.filter((r: { result: string }) => r.result.includes('no action') || r.result.includes('NO MIGRATION'))
      const errors  = results.filter((r: { result: string }) => r.result.startsWith('ERROR'))
      console.log(`[cron] chain ${chainId}: ${settled.length} settled, ${skipped.length} skipped, ${errors.length} errors`)
    } catch (err) {
      console.error(`[cron] chain ${chainId} failed:`, err instanceof Error ? err.message : err)
    }
  }
  console.log('[cron] Done.')
}

const ONE_HOUR = 60 * 60 * 1000
setInterval(cronJob, ONE_HOUR)
