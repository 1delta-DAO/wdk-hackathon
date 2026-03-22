# USDT007 — Permission to Fill

### The Settlement Primitive for Autonomous AI Agents in DeFi

**USDT007** is the infrastructure layer where AI agents and DeFi users meet — a permissionless settlement protocol that lets autonomous agents optimize, execute, and earn from user lending positions across protocols, all powered by the [Tether WDK](https://docs.wallet.tether.io).

Built for the **WDK Hackathon** — [Tether Wallet Development Kit](https://docs.wallet.tether.io). Live on **Arbitrum One** with real migrations executed on-chain.

---

## The Problem

DeFi users are leaving yield on the table. Lending rates shift constantly across Aave, Compound, Morpho Blue, and Silo — but manually migrating positions is complex, risky, and gas-intensive. Users need to repay debt, withdraw collateral, re-deposit, and re-borrow across protocols, all while monitoring health factors and gas costs. Most never bother. Their capital sits in suboptimal positions indefinitely.

Meanwhile, AI agents are getting smarter — but they lack a secure, trust-minimized way to act on users' behalf in DeFi. Giving an agent your private key is a non-starter. The missing piece isn't intelligence — it's **permission infrastructure**.

---

## The Solution

USDT007 introduces a **Merkle tree-based permission system** that bridges the trust gap between users and AI agents.

### How It Works

A user signs a **single off-chain EIP-712 order** containing a Merkle root that encodes every lending action they authorize — repay on Aave, withdraw collateral, deposit on Compound, borrow on Morpho — across as many destination protocols as they wish. That one 32-byte root, verified on-chain, is the agent's entire mandate.

The agent **cannot deviate from the signed leaf set**. It can only choose *which* of the pre-approved routes to execute and *when* — picking the destination with the best live rates at execution time. Every action is verified against the Merkle proof on-chain. No key delegation. No blanket approvals. Just cryptographically scoped permission.

```
User signs one Merkle root  →  Agent picks best route  →  Flash loan executes atomically
     (multiple approved           (live rate analysis)       (zero capital at risk)
      destinations)
```

### Why Merkle Trees?

| Traditional Approach | USDT007's Merkle Approach |
|---------------------|--------------------------|
| One signature per action | One signature, unlimited approved routes |
| Agent needs full wallet access | Agent only executes pre-approved leaves |
| User must predict best destination | Agent decides at execution time |
| Revocation requires on-chain tx | Order simply expires (off-chain) |

The Merkle tree is what makes this **safe delegation** — the user defines the boundaries, and the agent optimizes within them. No matter how many protocols are approved, the user signs exactly once.

---

## Architecture

### 1. Settlement Primitive for AI Agents

At its core, USDT007 is a **settlement layer** — a smart contract system that any AI agent can plug into to fill user intents. The settlement contract handles:

- **EIP-712 signature verification** — proves the user authorized the migration
- **Merkle proof validation** — every lending action maps to a signed leaf
- **Flash loan orchestration** — borrows debt, migrates position, repays in one atomic tx
- **Zero-sum delta accounting** — every token entering the contract must exit through a valid path
- **Health factor enforcement** — on-chain checks ensure positions remain safe post-migration

### 2. Safe User Permissions via Merkle Trees

Users never hand over keys or grant open-ended approvals. Instead:

1. **Select source position** (e.g., USDT debt on Aave V3 collateralized by wstETH)
2. **Approve destination protocols** (e.g., Compound V3, Morpho Blue, Silo V2)
3. **Sign EIP-712 order** — one signature covers the Merkle root of all authorized actions, a max fee cap, and a deadline
4. **Submit off-chain** — order is stored in the backend, waiting for an agent to fill it

Each Merkle leaf encodes a specific operation: `keccak256(opcode, lenderId, protocolData)`. The contract verifies the proof on-chain before executing any action. Leaves cover deposits, borrows, repays, and withdrawals across all supported protocols.

### 3. Economically Self-Sustaining Agents via WDK

The AI agent isn't just a bot executing calldata — it's an **autonomous economic actor** powered by the Tether WDK:

- **Velora DEX integration** (WDK swap module) — agent swaps USDT→ETH automatically when gas reserves run low, ensuring it can always fill orders
- **Aave V3 integration** (WDK lending module) — agent deposits idle USDT into Aave to earn yield between settlements
- **Portfolio reasoning** — GPT-4o evaluates swap costs, yield rates, gas prices, and treasury health to make economically rational decisions every cycle

The WDK abstracts wallet management, multi-protocol interactions, and transaction signing into composable modules — letting the agent focus on *strategy* rather than infrastructure.

### 4. Ecosystem Foundation for Agent-Earned Fees

USDT007 establishes the economic model for agents to **earn fees from open-ended user intents**:

- **Fee structure**: Agents borrow slightly more than the user's original debt; the surplus is the fee. Fees are capped by `maxFeeBps` (set by the user) and enforced on-chain — the contract reverts if the fee exceeds the cap.
- **Open competition**: Any agent can pick up open orders. The protocol is permissionless — better agents that find better rates and optimize gas costs will earn more.
- **Composable intents**: The Merkle leaf system is extensible. Today it covers lending migrations; tomorrow it can encode any DeFi action — swaps, LP rebalancing, vault strategies — creating an open marketplace where agents compete to fill user intents for fees.

This isn't just a migration tool. It's the **foundation for an intent-driven agent economy** where users express what they want, agents compete to deliver it, and the protocol ensures trust through cryptographic proofs — not custodial access.

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
