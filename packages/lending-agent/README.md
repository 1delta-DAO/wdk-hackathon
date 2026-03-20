# Lending Agent

AI-powered settlement agent that automatically migrates DeFi lending positions to better rates. It uses Claude to analyze on-chain positions via the [1delta MCP](https://mcp-prototype.1delta.io/mcp), picks the optimal destination protocol, and executes the migration through a [WDK](../wdk-mcp-toolkit/) wallet.

## How It Works

1. **Fetch open orders** from the order backend — each order contains signed merkle leaves authorizing specific lending operations (deposit, borrow, repay, withdraw) on specific protocols.
2. **Claude agent loop** analyzes the user's current positions and rates across protocols (Aave V3, Morpho Blue, Compound V3, Silo V2, etc.) using 1delta MCP tools.
3. **Propose migration** — the agent picks the source→destination combination that maximizes net yield improvement.
4. **Build & submit** — a `settleWithFlashLoan` transaction is constructed using the signed merkle proofs and submitted via the WDK wallet.

## Prerequisites

- Node.js ≥ 18
- [pnpm](https://pnpm.io/)
- An [Anthropic API key](https://console.anthropic.com/)
- A BIP-39 seed phrase for the WDK wallet (or a running WDK HTTP server)
- A running [order backend](../order-backend/) instance

## Setup

```bash
# Install dependencies (from repo root)
pnpm install

# Copy env template
cp .env.example .env
```

Fill in your `.env`:

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Claude API key |
| `WDK_SEED` | Yes* | BIP-39 seed phrase (12 or 24 words). *Not needed if using `WDK_MCP_URL`. |
| `ORDER_BACKEND_URL` | Yes | URL of the order backend (default: `http://localhost:8787`) |
| `MODEL` | No | Claude model (default: `claude-opus-4-6`) |
| `ONEDELTA_API_KEY` | No | 1delta API key for higher rate limits |
| `DRY_RUN` | No | Set `true` to skip transaction submission (default: `true`) |
| `API_SECRET` | No | Bearer token to protect `/settle/*` HTTP endpoints |
| `CRON_CHAIN_IDS` | No | Comma-separated chain IDs for the cron job (default: `42161`) |
| `WDK_MCP_URL` | No | URL of a remote WDK HTTP server (replaces stdio mode) |
| `ECONOMIC_MODE` | No | Skip settlements where gas > solver fee (default: `true`) |

## Running

### Local (Node.js)

```bash
# Build and run
pnpm build
pnpm dev
```

This starts an HTTP server on port 3000 (configurable via `PORT`) with an hourly cron job.

### Cloudflare Worker

```bash
# Copy wrangler config
cp wrangler.example.toml wrangler.toml
# Edit wrangler.toml or set secrets via:
# wrangler secret put ANTHROPIC_API_KEY
# wrangler secret put WDK_MCP_URL
# wrangler secret put ORDER_BACKEND_URL
# wrangler secret put API_SECRET

# Local dev
pnpm worker:dev

# Deploy
pnpm worker:deploy

# Tail logs
pnpm worker:tail
```

The worker runs a cron trigger every hour (`0 * * * *`).

## API Endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/health` | None | Liveness check |
| `GET` | `/address` | None | Returns the agent's EVM wallet address |
| `POST` | `/settle/all` | Bearer | Settle all open orders for a chain. Body: `{ "chainId": 42161 }` |

## Architecture

```
index.ts          — Node.js HTTP server + hourly cron
worker.ts         — Cloudflare Worker entry point (same routes + scheduled trigger)
src/
  agent.ts        — Claude agent loop (tool calling with adaptive thinking)
  config.ts       — Environment config, contract addresses, chain RPCs
  main.ts         — Settlement orchestration (fetch order → agent → execute)
  mcp.ts          — MCP client connections (1delta + WDK) and tool routing
  order.ts        — Order backend client, merkle leaf decoders
  prompt.ts       — System prompt builder for the settlement agent
  settle.ts       — Transaction builder (settleWithFlashLoan) + economic viability check
```

## Supported Chains

| Chain | ID |
|---|---|
| Arbitrum One | `42161` |

## Supported Protocols

- Aave V3 / V2
- Compound V3 / V2
- Morpho Blue
- Silo V2

## Testing

```bash
pnpm test
pnpm test:watch
```
