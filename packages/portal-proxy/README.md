# Portal Proxy

Cloudflare Worker that proxies requests to the [1delta portal API](https://portal.1delta.io) and injects an API key stored as a Worker secret.

The frontend uses this proxy to fetch live lending rates and user positions without the 1delta API key ever being exposed to the browser.

---

## How It Works

Every request to `https://portal-proxy.your-worker.workers.dev/<path>?<query>` is forwarded verbatim to `https://portal.1delta.io/<path>?<query>` with:

- The `x-api-key` header set to the `PORTAL_API_KEY` secret
- The `host` header removed (so upstream sees the correct host)
- CORS headers added to the response

---

## Setup

```bash
cd packages/portal-proxy
pnpm install
```

### Secrets

```bash
wrangler secret put PORTAL_API_KEY
```

Get an API key at [auth.1delta.io](https://auth.1delta.io). Without a key the 1delta API still works but is rate-limited.

### Run locally

```bash
pnpm dev
```

### Deploy

```bash
pnpm deploy
```

---

## Used By

- **Frontend** — fetches user positions (`/v1/data/lending/user-positions`) and market rates (`/v1/data/lending/latest`) for the position viewer and order builder.

The lending agent calls the 1delta portal API directly (with its own API key from `ONEDELTA_API_KEY`), so it does not go through this proxy.
