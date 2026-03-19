export { Orderbook } from './orderbook.js'

interface Env {
  ORDERBOOK: DurableObjectNamespace
}

/**
 * Cloudflare Worker entry point.
 *
 * Routes requests to a per-chainId Durable Object instance so orders
 * are partitioned by chain. The chainId is extracted from the URL path
 * or query parameter.
 *
 * API:
 *   POST   /v1/orders              — Submit a signed order (body: {order, signature, signer})
 *   GET    /v1/orders              — List open orders (query: ?chainId=&signer=&status=&limit=)
 *   GET    /v1/orders/:id          — Get a specific order
 *   PATCH  /v1/orders/:id          — Update order status (body: {status: "filled"|"cancelled"})
 *   DELETE /v1/orders/:id          — Cancel an order
 *   GET    /v1/chains              — List chain IDs that have orders
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
        },
      })
    }

    const url = new URL(request.url)
    const path = url.pathname

    // Health check
    if (path === '/' || path === '/health') {
      return json({ status: 'ok', service: 'order-backend' })
    }

    // Strip /v1 prefix
    if (!path.startsWith('/v1/')) {
      return json({ error: 'Not found. API is at /v1/' }, 404)
    }

    const apiPath = path.slice(3) // remove /v1

    // POST /v1/orders — submit order, chainId is in the body
    if (request.method === 'POST' && apiPath === '/orders') {
      const body = await request.clone().json<{ order?: { chainId?: number } }>()
      const chainId = body?.order?.chainId
      if (!chainId) return json({ error: 'Missing order.chainId' }, 400)

      const stub = getOrderbookStub(env, chainId)
      return stub.fetch(new Request('https://do/orders', {
        method: 'POST',
        headers: request.headers,
        body: request.body,
      }))
    }

    // GET /v1/orders — list orders, chainId from query param
    if (request.method === 'GET' && apiPath === '/orders') {
      const chainId = parseInt(url.searchParams.get('chainId') || '0')
      if (!chainId) return json({ error: 'Query param chainId is required' }, 400)

      const stub = getOrderbookStub(env, chainId)
      const doUrl = new URL('https://do/orders')
      // Forward query params
      for (const [k, v] of url.searchParams) {
        if (k !== 'chainId') doUrl.searchParams.set(k, v)
      }
      return stub.fetch(new Request(doUrl.toString()))
    }

    // GET/PATCH/DELETE /v1/orders/:id?chainId=
    const orderMatch = apiPath.match(/^\/orders\/([a-f0-9-]+)$/)
    if (orderMatch) {
      const id = orderMatch[1]
      const chainId = parseInt(url.searchParams.get('chainId') || '0')
      if (!chainId) return json({ error: 'Query param chainId is required' }, 400)

      const stub = getOrderbookStub(env, chainId)
      return stub.fetch(new Request(`https://do/orders/${id}`, {
        method: request.method,
        headers: request.headers,
        body: request.body,
      }))
    }

    return json({ error: 'Not found' }, 404)
  },
} satisfies ExportedHandler<Env>

function getOrderbookStub(env: Env, chainId: number): DurableObjectStub {
  const doId = env.ORDERBOOK.idFromName(`chain-${chainId}`)
  return env.ORDERBOOK.get(doId)
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
