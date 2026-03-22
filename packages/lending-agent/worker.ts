/**
 * Cloudflare Worker entry point for the lending-agent settlement service.
 *
 * Routes:
 *   GET  /health              — liveness check
 *   GET  /address             — returns the agent wallet address (public)
 *   POST /settle/all          — run settlement for all open orders (bearer-protected)
 *                               body: { chainId: number, forceMigration?: boolean }
 *   POST /settle/order        — run settlement for one order (bearer-protected)
 *                               body: { orderId: string, chainId: number, forceMigration?: boolean }
 *
 * Cron trigger (every hour):
 *   Runs the orchestrator loop for each configured chain.
 *
 * Required secrets (set via `wrangler secret put`):
 *   OPENAI_API_KEY    — OpenAI API key
 *   WDK_SEED          — BIP-39 seed phrase for the solver wallet
 *   ORDER_BACKEND_URL — URL of the order backend
 *   API_SECRET        — bearer token to protect /settle/* endpoints
 *
 * Optional:
 *   ONEDELTA_API_KEY  — bearer token for 1delta MCP
 *   MODEL             — model override (default: gpt-4o-mini)
 *   DRY_RUN           — "true" to skip on-chain submission
 *   CRON_CHAIN_IDS    — comma-separated chain IDs (default: "42161")
 */

import { runAllSettlements, runSettlementFlow } from './src/main.js'
import { runOrchestrator } from './src/orchestrator.js'
import { getWdkAddress } from './src/wdk.js'
import { RPC_URL_BY_CHAIN } from './src/config.js'

export interface Env {
  OPENAI_API_KEY: string
  WDK_SEED: string
  ORDER_BACKEND_URL: string
  API_SECRET: string
  ONEDELTA_API_KEY?: string
  MODEL?: string
  DRY_RUN?: string
  CRON_CHAIN_IDS?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function injectEnv (env: Env): void {
  process.env.OPENAI_API_KEY   = env.OPENAI_API_KEY
  process.env.WDK_SEED         = env.WDK_SEED
  process.env.ORDER_BACKEND_URL = env.ORDER_BACKEND_URL ?? 'http://localhost:8787'
  process.env.ONEDELTA_API_KEY = env.ONEDELTA_API_KEY ?? ''
  process.env.MODEL            = env.MODEL ?? 'gpt-4o-mini'
  process.env.DRY_RUN          = env.DRY_RUN ?? 'false'
}

function unauthorized (): Response {
  return Response.json({ error: 'Unauthorized' }, {
    status: 401,
    headers: { 'WWW-Authenticate': 'Bearer' },
  })
}

function bearerOk (request: Request, env: Env): boolean {
  const auth  = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return !!env.API_SECRET && token === env.API_SECRET
}

// ── Fetch handler ─────────────────────────────────────────────────────────────

export default {
  async fetch (request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    injectEnv(env)
    const url = new URL(request.url)

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    if (request.method === 'GET' && url.pathname === '/address') {
      const rpcUrl = RPC_URL_BY_CHAIN[42161]
      const address = await getWdkAddress(env.WDK_SEED, rpcUrl)
      return Response.json({ address })
    }

    if (request.method === 'POST' && url.pathname === '/settle/all') {
      if (!bearerOk(request, env)) return unauthorized()
      let body: Record<string, unknown> = {}
      try { body = await request.json() as Record<string, unknown> } catch { /* ok */ }
      const chainId = Number(body.chainId)
      if (!chainId) return Response.json({ error: 'chainId required' }, { status: 400 })
      const forceMigration = body.forceMigration === true
      const results = await runAllSettlements(chainId, forceMigration)
      return Response.json({ results })
    }

    if (request.method === 'POST' && url.pathname === '/settle/order') {
      if (!bearerOk(request, env)) return unauthorized()
      let body: Record<string, unknown> = {}
      try { body = await request.json() as Record<string, unknown> } catch { /* ok */ }
      const orderId = String(body.orderId ?? '')
      const chainId = Number(body.chainId)
      if (!orderId) return Response.json({ error: 'orderId required' }, { status: 400 })
      if (!chainId) return Response.json({ error: 'chainId required' }, { status: 400 })
      const forceMigration = body.forceMigration === true
      const result = await runSettlementFlow(orderId, chainId, forceMigration)
      return Response.json({ orderId, result })
    }

    return new Response('Not found', { status: 404 })
  },

  // ── Cron handler ─────────────────────────────────────────────────────────────
  async scheduled (_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    injectEnv(env)
    const chainIds = (env.CRON_CHAIN_IDS ?? '42161')
      .split(',').map(s => Number(s.trim())).filter(Boolean)

    ctx.waitUntil((async () => {
      for (const chainId of chainIds) {
        await runOrchestrator(chainId)
      }
    })())
  },
}
