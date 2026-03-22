# 1delta Migration Agent — WDK Hackathon

An end-to-end DeFi automation stack that lets users permissionlessly migrate their lending positions to better-rate protocols, executed atomically by an AI agent.

Built for the **WDK Hackathon** — [Tether Wallet Development Kit](https://docs.wallet.tether.io).

---

## What It Does

Users sign a single off-chain order authorizing a move from their current lending position (e.g. Aave V3, Compound V3, Morpho Blue) to any better-rate protocol of their choice. An AI agent picks up the order, reasons about the best destination using live market data, and executes the migration atomically via a flash loan — **no capital at risk, no protocol downtime**.

The same agent also manages its own treasury: earning USDT fees from each settlement, topping up its ETH gas reserve automatically, and deploying idle USDT into Aave for yield.

---

## System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         User Browser                            │
│  Frontend (React/Wagmi) — signs order + permits, submits order  │
└──────────────────┬──────────────────────────────────────────────┘
                   │ POST /v1/orders
                   ▼
┌──────────────────────────────────────┐
│  Order Backend (Cloudflare Worker)   │
│  Durable Object per chain            │
│  Stores signed orders, serves them   │
└───────────────┬──────────────────────┘
                │ GET /v1/orders (open)
                ▼
┌─────────────────────────────────────────────────────────────────┐
│               Lending Agent (Cloudflare Worker / Node.js)       │
│                                                                 │
│  Orchestrator (GPT-4o)                                          │
│    ├── Settlement Agent — fills user migration orders           │
│    │     ├── Fetches positions + rates via 1delta portal API    │
│    │     ├── Picks best source→dest pair (yield improvement)    │
│    │     └── Executes settleWithFlashLoan via WDK wallet        │
│    └── Portfolio Agent — manages solver treasury                │
│          ├── Swaps USDT→ETH when gas reserve low (Velora DEX)  │
│          └── Deposits idle USDT into Aave V3 for yield          │
└──────────────────────────────┬──────────────────────────────────┘
                               │ on-chain
                               ▼
┌──────────────────────────────────────────────────────────────────┐
│                 Settlement Contract (Arbitrum)                    │
│  Flash loan → repay source debt → withdraw collateral            │
│  → deposit collateral → borrow on dest → repay flash loan        │
│  All verified against the Merkle root the user signed            │
└──────────────────────────────────────────────────────────────────┘
```

### Data flow for the frontend

```
Frontend → portal-proxy → portal.1delta.io
```

The portal proxy is a thin Cloudflare Worker that adds the 1delta API key (stored as a Worker secret) so the frontend can fetch live rates and user positions without exposing the key.

---

## Packages

| Package | Description |
|---------|-------------|
| [packages/frontend](packages/frontend/) | React + Wagmi UI — wallet connect, position viewer, order signing |
| [packages/order-backend](packages/order-backend/) | Cloudflare Worker + Durable Objects — order storage and serving |
| [packages/portal-proxy](packages/portal-proxy/) | Cloudflare Worker — 1delta portal API proxy (hides API key) |
| [packages/lending-agent](packages/lending-agent/) | AI agent — settlement + autonomous treasury management |
| [packages/contracts](packages/contracts/) | Solidity — atomic flash-loan migration contracts |
| [packages/settlement-sdk](packages/settlement-sdk/) | TypeScript SDK — calldata builders, EIP-712 helpers |

---

## Supported Protocols & Chains

**Protocols**: Aave V3 · Compound V3 · Morpho Blue · Silo V2

**Chain**: Arbitrum One (`42161`)

---

## Live Transactions

All four migrations below were executed on-chain by the agent on Arbitrum One. Each flash-borrows the debt asset from Morpho Blue, moves the user's position atomically, and repays the flash loan in a single `multicall`.

| Migration | Tx |
|-----------|-----|
| Morpho Blue → Compound V3 (wstETH/USDT) | [0xa5fa1b7b…](https://arbiscan.io/tx/0xa5fa1b7bdf27ccf8700f6bdd897c33742d7b7e4bba569300f82852258f283a1a) |
| Compound V3 → Morpho Blue (wstETH/USDT) | [0xe6fbd29d…](https://arbiscan.io/tx/0xe6fbd29dbf2f8d053b642dc62f1627ca3186b6985127374e009603be3b4f10f2) |
| Aave V3 → Compound V3 (wstETH/USDT) | [0x95a88d7b…](https://arbiscan.io/tx/0x95a88d7bdc5894d04d8ff54427613b9a7ffc726cb85067c7d5bbaf40a06372c9) |
| Compound V3 → Aave V3 (WETH/USDT) | [0xf00d3adf…](https://arbiscan.io/tx/0xf00d3adfd6aec4cdf925cdfd8519c51a8ca6c75b982209e1fbd5618261e67430) |

---

## Setup

```bash
# Install all dependencies
pnpm install

# Build all packages
pnpm build
```

See each package's README for deployment instructions:
- [Frontend](packages/frontend/README.md)
- [Order Backend](packages/order-backend/README.md)
- [Portal Proxy](packages/portal-proxy/README.md)
- [Lending Agent](packages/lending-agent/README.md)
