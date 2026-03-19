import type { SignedOrder, StoredOrder, OrderQuery } from './types.js'

/**
 * Durable Object that stores settlement orders.
 *
 * Uses a single DO instance per chain ID so orders are partitioned by chain.
 * Storage keys: `order:<id>` for individual orders, indexed by deadline for expiry sweeps.
 */
export class Orderbook implements DurableObject {
  private state: DurableObjectState

  constructor(state: DurableObjectState) {
    this.state = state
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (request.method === 'POST' && url.pathname === '/orders') {
      return this.submitOrder(request)
    }

    if (request.method === 'GET' && url.pathname === '/orders') {
      return this.listOrders(url)
    }

    if (request.method === 'GET' && url.pathname.startsWith('/orders/')) {
      const id = url.pathname.slice('/orders/'.length)
      return this.getOrder(id)
    }

    if (request.method === 'PATCH' && url.pathname.startsWith('/orders/')) {
      const id = url.pathname.slice('/orders/'.length)
      return this.updateOrderStatus(id, request)
    }

    if (request.method === 'DELETE' && url.pathname.startsWith('/orders/')) {
      const id = url.pathname.slice('/orders/'.length)
      return this.cancelOrder(id)
    }

    return json({ error: 'Not found' }, 404)
  }

  private async submitOrder(request: Request): Promise<Response> {
    const body = await request.json<SignedOrder>()

    const err = validateSignedOrder(body)
    if (err) return json({ error: err }, 400)

    const now = Math.floor(Date.now() / 1000)
    if (body.order.deadline <= now) {
      return json({ error: 'Order already expired' }, 400)
    }

    const id = crypto.randomUUID()
    const stored: StoredOrder = {
      ...body,
      id,
      createdAt: now,
      status: 'open',
    }

    await this.state.storage.put(`order:${id}`, stored)

    return json({ id, status: 'open' }, 201)
  }

  private async listOrders(url: URL): Promise<Response> {
    const signer = url.searchParams.get('signer')?.toLowerCase()
    const status = url.searchParams.get('status') || 'open'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200)

    const all = await this.state.storage.list<StoredOrder>({ prefix: 'order:' })
    const now = Math.floor(Date.now() / 1000)
    const results: StoredOrder[] = []

    for (const [key, order] of all) {
      // Auto-expire
      if (order.status === 'open' && order.order.deadline <= now) {
        order.status = 'expired'
        await this.state.storage.put(key, order)
      }

      if (status && order.status !== status) continue
      if (signer && order.signer.toLowerCase() !== signer) continue

      results.push(order)
      if (results.length >= limit) break
    }

    // Sort by deadline ascending (most urgent first) for agents
    results.sort((a, b) => a.order.deadline - b.order.deadline)

    return json(results)
  }

  private async getOrder(id: string): Promise<Response> {
    const order = await this.state.storage.get<StoredOrder>(`order:${id}`)
    if (!order) return json({ error: 'Order not found' }, 404)

    // Auto-expire
    const now = Math.floor(Date.now() / 1000)
    if (order.status === 'open' && order.order.deadline <= now) {
      order.status = 'expired'
      await this.state.storage.put(`order:${id}`, order)
    }

    return json(order)
  }

  private async updateOrderStatus(id: string, request: Request): Promise<Response> {
    const order = await this.state.storage.get<StoredOrder>(`order:${id}`)
    if (!order) return json({ error: 'Order not found' }, 404)

    const { status } = await request.json<{ status: StoredOrder['status'] }>()
    if (!['filled', 'cancelled'].includes(status)) {
      return json({ error: 'Can only set status to "filled" or "cancelled"' }, 400)
    }

    order.status = status
    await this.state.storage.put(`order:${id}`, order)

    return json({ id, status })
  }

  private async cancelOrder(id: string): Promise<Response> {
    const order = await this.state.storage.get<StoredOrder>(`order:${id}`)
    if (!order) return json({ error: 'Order not found' }, 404)

    order.status = 'cancelled'
    await this.state.storage.put(`order:${id}`, order)

    return json({ id, status: 'cancelled' })
  }
}

function validateSignedOrder(body: unknown): string | null {
  if (!body || typeof body !== 'object') return 'Body must be a JSON object'

  const o = body as Record<string, unknown>
  if (!o.order || typeof o.order !== 'object') return 'Missing "order" field'
  if (!o.signature || typeof o.signature !== 'string') return 'Missing "signature" field'
  if (!o.signer || typeof o.signer !== 'string') return 'Missing "signer" field'

  const order = o.order as Record<string, unknown>
  if (!order.merkleRoot) return 'Missing order.merkleRoot'
  if (!order.deadline || typeof order.deadline !== 'number') return 'Missing order.deadline'
  if (!order.settlementData) return 'Missing order.settlementData'
  if (!order.orderData) return 'Missing order.orderData'
  if (!order.executionData) return 'Missing order.executionData'
  if (order.fillerCalldata === undefined) return 'Missing order.fillerCalldata'
  if (!order.chainId || typeof order.chainId !== 'number') return 'Missing order.chainId'
  if (order.maxFeeBps === undefined || typeof order.maxFeeBps !== 'number') return 'Missing order.maxFeeBps'

  return null
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
