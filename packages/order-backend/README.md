# Order Backend

Cloudflare Worker that collects signed migration orders from the frontend and serves them to the AI lending agent.

Uses [Durable Objects](https://developers.cloudflare.com/durable-objects/) to store orders durably, with one object per chain so reads and writes are always consistent within a chain.

---

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/orders` | Submit a signed order. Body: `{ order, signature, signer }` |
| `GET` | `/v1/orders?chainId=` | List orders. Optional filters: `signer=`, `status=open\|filled\|cancelled`, `limit=` |
| `GET` | `/v1/orders/:id?chainId=` | Get a single order by ID |
| `PATCH` | `/v1/orders/:id?chainId=` | Update order status. Body: `{ status: "filled" \| "cancelled" }` |
| `DELETE` | `/v1/orders/:id?chainId=` | Cancel a specific order |
| `DELETE` | `/v1/orders?chainId=` | Clear all orders for a chain |
| `GET` | `/health` | Liveness check |

All responses include `Access-Control-Allow-Origin: *` CORS headers so the frontend can call directly from the browser.

### Order status lifecycle

```
open → filled   (set by the lending agent after on-chain settlement)
open → cancelled  (set by user via DELETE or PATCH)
```

---

## Order shape

```typescript
{
  id: string            // UUID assigned on submission
  signer: string        // user wallet address
  status: "open" | "filled" | "cancelled"
  createdAt: number     // unix timestamp ms
  order: {
    chainId: number
    deadline: number    // unix timestamp (seconds)
    maxFeeBps: number   // max solver fee in 1e-7 units (10_000_000 = 100%)
    leaves: MerkleLeaf[]
    orderData: string   // packed merkleRoot + settlementData (hex)
    permits: SignedPermit[]
  }
  signature: string     // EIP-712 signature over the order
}
```

---

## Setup

```bash
cd packages/order-backend
pnpm install
```

No environment variables are required — the Worker has no secrets.

### Run locally

```bash
pnpm dev
```

### Deploy

```bash
pnpm deploy
```

The Durable Object namespace `ORDERBOOK` must be declared in `wrangler.toml` (already configured).

---

## Implementation Notes

- Orders are stored entirely in Durable Object SQLite storage — no external DB needed.
- The Worker is stateless; the Durable Object holds all state and handles one chain at a time, so there are no race conditions on order writes.
- Order IDs are random UUIDs generated at submission time.
