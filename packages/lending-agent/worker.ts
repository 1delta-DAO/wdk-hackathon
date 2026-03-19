/**
 * Cloudflare Worker entry point for the lending-agent settlement service.
 *
 * Routes:
 *   GET  /address             — returns the agent wallet address (public)
 *   POST /settle/all          — run settlement for all open orders (bearer-protected)
 *                               body: { chainId: number, settlementAddress?: string }
 *
 * Cron trigger (every hour):
 *   Runs the same settlement loop as POST /settle/all for each configured chain.
 *
 * Required secrets (set via `wrangler secret put`):
 *   ANTHROPIC_API_KEY   — Claude API key
 *   WDK_MCP_URL         — URL of the WDK HTTP sidecar  (examples/http/index.js)
 *   ORDER_BACKEND_URL   — URL of the order backend
 *   API_SECRET          — bearer token to protect /settle/* endpoints
 *
 * Optional:
 *   ONEDELTA_API_KEY    — bearer token for 1delta MCP
 *   MODEL               — Claude model override  (default: claude-opus-4-6)
 *   DRY_RUN             — "true" to skip on-chain submission
 *   CRON_CHAIN_IDS      — comma-separated chain IDs for cron runs  (default: "42161")
 */

import { connectOneDelta, connectWdk, callTool } from './src/mcp.js'
import { runAllSettlements } from './src/main.js'

export interface Env {
  // Secrets
  ANTHROPIC_API_KEY: string
  WDK_MCP_URL: string
  ORDER_BACKEND_URL: string
  API_SECRET: string
  // Optional
  ONEDELTA_API_KEY?: string
  MODEL?: string
  DRY_RUN?: string
  CRON_CHAIN_IDS?: string
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function injectEnv (env: Env): void {
  const vals: Record<string, string> = {
    ANTHROPIC_API_KEY:  env.ANTHROPIC_API_KEY,
    WDK_MCP_URL:        env.WDK_MCP_URL,
    ORDER_BACKEND_URL:  env.ORDER_BACKEND_URL ?? 'http://localhost:8787',
    ONEDELTA_API_KEY:   env.ONEDELTA_API_KEY ?? '',
    MODEL:              env.MODEL ?? 'claude-opus-4-6',
    DRY_RUN:            env.DRY_RUN ?? 'false',
  }
  for (const [k, v] of Object.entries(vals)) process.env[k] = v
}

function unauthorized (): Response {
  return Response.json({ error: 'Unauthorized' }, {
    status: 401,
    headers: { 'WWW-Authenticate': 'Bearer' },
  })
}

function bearerOk (request: Request, env: Env): boolean {
  const auth = request.headers.get('Authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  return !!env.API_SECRET && token === env.API_SECRET
}

async function runSettle (env: Env, chainId: number) {
  const [oneDeltaClient, wdkClient] = await Promise.all([connectOneDelta(), connectWdk()])
  try {
    return await runAllSettlements({ oneDeltaClient, wdkClient }, chainId)
  } finally {
    await Promise.allSettled([oneDeltaClient.close(), wdkClient.close()])
  }
}

// ── Fetch handler ─────────────────────────────────────────────────────────────

export default {
  async fetch (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    injectEnv(env)

    const url = new URL(request.url)

    // ── GET /address ──────────────────────────────────────────────────────────
    // Returns the EVM address that the agent wallet will sign/send from.
    if (request.method === 'GET' && url.pathname === '/address') {
      const wdkClient = await connectWdk()
      try {
        const address = await callTool(wdkClient, 'getAddress', { chain: 'ethereum' })
        return Response.json({ address })
      } finally {
        await wdkClient.close()
      }
    }

    // ── POST /settle/all ──────────────────────────────────────────────────────
    // Fetches all open orders for the given chainId and runs the settlement
    // flow on each. Returns an array of { orderId, result } objects.
    // Protected with Bearer token.
    if (request.method === 'POST' && url.pathname === '/settle/all') {
      if (!bearerOk(request, env)) return unauthorized()

      let body: Record<string, unknown> = {}
      try { body = await request.json() as Record<string, unknown> } catch { /* ok */ }

      const chainId = Number(body.chainId)
      if (!chainId) return Response.json({ error: 'chainId required' }, { status: 400 })

      const results = await runSettle(env, chainId)
      return Response.json({ results })
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ status: 'ok' })
    }

    return new Response('Not found', { status: 404 })
  },

  // ── Cron handler ─────────────────────────────────────────────────────────────
  // Triggered every hour by the schedule in wrangler.toml.
  // Processes all open orders on each configured chain sequentially.
  async scheduled (_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    injectEnv(env)

    const chainIds = (env.CRON_CHAIN_IDS ?? '42161')
      .split(',')
      .map(s => Number(s.trim()))
      .filter(Boolean)

    console.log(`[cron] Starting hourly settlement run for chains: ${chainIds.join(', ')}`)

    ctx.waitUntil((async () => {
      for (const chainId of chainIds) {
        console.log(`[cron] Processing chain ${chainId}…`)
        try {
          const results = await runSettle(env, chainId)
          const settled  = results.filter(r => !r.result.startsWith('ERROR') && r.result !== 'DRY_RUN')
          const skipped  = results.filter(r => r.result.includes('no action') || r.result.includes('NO MIGRATION'))
          const errors   = results.filter(r => r.result.startsWith('ERROR'))
          console.log(`[cron] chain ${chainId}: ${settled.length} settled, ${skipped.length} skipped, ${errors.length} errors`)
        } catch (err) {
          console.error(`[cron] chain ${chainId} failed:`, err instanceof Error ? err.message : err)
        }
      }
      console.log('[cron] Hourly settlement run complete.')
    })())
  },
}
