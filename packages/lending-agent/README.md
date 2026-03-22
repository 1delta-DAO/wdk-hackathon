# Lending Agent

An autonomous DeFi agent that settles user loan migrations between lending protocols **and** manages its own treasury — deciding when to act, what to do, and why.

Built with OpenAI (GPT-4o), the WDK (Tether Wallet Development Kit), and 1delta.

---

## What It Does

### For Users — Loan Migration Settlement

Users sign orders authorizing the agent to move their open lending position from one protocol to a better one (e.g. Aave → Morpho Blue at a lower borrow rate). The agent:

1. Picks up signed orders from the order backend
2. Analyzes the user's current position and available destination markets via the 1delta portal API
3. Picks the migration that maximizes net yield improvement
4. Executes the migration atomically via a flash loan — no liquidity risk to the user

The execution path:

```
Flash loan USDT (Morpho Blue)
  → Repay user's debt on source protocol
  → Withdraw user's collateral from source protocol
  → Deposit collateral on destination protocol
  → Borrow USDT on destination protocol (repays flash loan + solver fee)
```

All four operations are verified against a Merkle tree the user signed — the agent cannot deviate from the authorized set of protocols and parameters.

### For the Solver — Autonomous Treasury Management

The agent earns USDT fees from each settlement it fills and spends ETH for Arbitrum gas. After each settlement batch the **portfolio agent** rebalances the solver's own wallet:

- **Gas reserve**: If ETH < $5, swaps USDT → ETH via WDK (Velora DEX)
- **Idle USDT yield**: If wallet USDT > $20, deposits excess into Aave V3 to earn supply APY
- **Staking yield**: If ETH significantly exceeds the reserve, considers wstETH for passive staking income

---

## External APIs & Services

| Service | Used For |
|---------|----------|
| **1delta Portal API** (`portal.1delta.io`) | Fetches the user's current lending positions and open borrow/collateral balances across Aave, Compound, and Morpho on Arbitrum. Used before each settlement to build the migration context. |
| **WDK — Velora DEX** (`@tetherto/wdk-protocol-swap-velora-evm`) | Swaps USDT → ETH when the solver's gas reserve runs low. Handles route discovery and ERC-20 approval automatically. |
| **WDK — Aave V3** (`@tetherto/wdk-protocol-lending-aave-evm`) | Deposits idle USDT into Aave V3 to earn supply APY, and withdraws when ETH needs topping up. |
| **WDK — EVM Wallet** (`@tetherto/wdk-wallet-evm`) | Derives the solver wallet from a BIP-39 seed phrase and signs/broadcasts all on-chain transactions (settlements, swaps, Aave ops). |
| **Morpho Blue (on-chain)** | Flash loan provider for the settlement transaction. Lends the full debt amount for one block with no upfront capital required from the solver. |
| **Aave Oracle (on-chain)** | Provides USD prices for ETH and debt tokens, used for the economic viability check (solver fee vs gas cost) and for treasury balance reporting. |
| **OpenAI API** | GPT-4o drives the orchestrator, settlement, and portfolio agents — reasoning about which orders to fill, which migration to execute, and how to rebalance the treasury. |

---

## Architecture

```
Orchestrator (GPT-4o)
  ├── Assesses state: open orders + wallet balances + ETH price
  ├── Decides: settle / manage portfolio / skip cycle
  │
  ├── Settlement Agent (GPT-4o)
  │     ├── Fetches open orders from order backend
  │     ├── Builds settlement context: positions + rates from 1delta portal API
  │     ├── Picks the best source→destination pair (highest yield improvement)
  │     └── Executes settleWithFlashLoan via WDK wallet
  │
  └── Portfolio Agent (GPT-4o)
        ├── Reads wallet state: ETH, USDT, aUSDT, ETH price
        ├── Plans actions (record_actions tool)
        └── Executes via WDK: swap (Velora), Aave supply/withdraw
```

Each agent uses GPT-4o to reason about strategy — not just execute predetermined logic.

### Source Files

| File | Role |
|------|------|
| `src/orchestrator.ts` | Top-level loop: assesses state, decides which agents to run |
| `src/main.ts` | Settlement orchestration: fetch order → agent → execute |
| `src/portfolioAgent.ts` | Treasury management: gas reserve, Aave yield, wstETH |
| `src/settle.ts` | Builds `settleWithFlashLoan` calldata, economic viability check |
| `src/context.ts` | Pre-fetches positions + market rates from 1delta portal API |
| `src/prompt.ts` | System prompt builders for settlement and portfolio agents |
| `src/agent.ts` | Agent loop (tool calling) |
| `src/mcp.ts` | Local tool router — no external MCP servers needed |
| `src/wdk.ts` | WDK wallet helpers: address, swap, Aave supply/withdraw, sendTransaction |
| `src/order.ts` | Order backend client, Merkle leaf decoders |
| `src/config.ts` | Contract addresses, chain RPCs, feature flags |

### Key Concepts

**Merkle order**: The user signs a Merkle tree whose leaves encode specific lending operations on specific protocols. The agent can only execute combinations authorized by the signed root — it cannot move funds to unauthorized protocols.

**Flash loan settlement**: The solver has no capital at risk. Morpho Blue lends the debt amount for one block, the migration executes atomically, and the destination protocol repays the flash loan in the same transaction.

**Economic mode**: Before submitting, the agent estimates gas cost vs solver fee using the Aave oracle for USD prices. If the fee doesn't cover gas, the order is skipped (`SKIPPED_NOT_ECONOMIC`). On Arbitrum gas is < $0.01, so any position > ~$1 debt is viable.

**On-chain auth checks**: Before including `setAuthorizationWithSig` / `allowBySig` / delegation calls in the multicall, the agent checks if the settlement contract is already authorized on-chain and skips redundant permit calls.

**No external MCP servers**: The WDK wallet and 1delta data are accessed directly via their npm packages and REST API — no MCP server process required. The agent runs fully self-contained as a single Cloudflare Worker or Node.js process.

---

## Setup

### Prerequisites

- Node.js ≥ 20 (required by Wrangler for Cloudflare deployment)
- pnpm
- OpenAI API key
- BIP-39 seed phrase for the solver wallet
- Running [order backend](../order-backend/) instance

### Install

```bash
# From repo root
pnpm install
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `WDK_SEED` | Yes | BIP-39 seed phrase controlling the solver wallet |
| `ORDER_BACKEND_URL` | Yes | Order backend URL (default: `http://localhost:8787`) |
| `API_SECRET` | Yes | Bearer token protecting `/settle/*` endpoints |
| `MODEL` | No | Model to use (default: `gpt-4o-mini`) |
| `ONEDELTA_API_KEY` | No | 1delta portal API key for higher rate limits |
| `DRY_RUN` | No | `true` = print calldata, don't submit (default: `false`) |
| `ECONOMIC_MODE` | No | `true` = skip orders where gas > solver fee (default: `true`) |
| `CRON_CHAIN_IDS` | No | Comma-separated chain IDs (default: `42161`) |

---

## Running

### Local (Node.js)

```bash
cd packages/lending-agent
pnpm build && pnpm start
```

Or with a `.env` file:

```bash
pnpm dev
```

Starts an HTTP server on port 3000 with an hourly cron trigger.

### Cloudflare Worker

```bash
# Set secrets (encrypted — never stored in wrangler.toml):
wrangler secret put OPENAI_API_KEY
wrangler secret put WDK_SEED
wrangler secret put API_SECRET
wrangler secret put ONEDELTA_API_KEY   # optional

pnpm worker:dev     # local preview
pnpm worker:deploy  # deploy to Cloudflare
pnpm worker:tail    # stream live logs
```

The worker runs on a cron schedule (`0 * * * *` — every hour) and also exposes HTTP endpoints for manual triggering.

> **Note:** `sodium-native` (a Node.js native addon used by the WDK wallet for memory zeroing) cannot run in Cloudflare Workers. It is aliased to a pure-JS stub in `wrangler.toml`. See [`docs/sodium-native-stub.md`](docs/sodium-native-stub.md) for details.

---

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/health` | — | Liveness check |
| `GET` | `/address` | — | Returns the solver wallet address |
| `POST` | `/settle/all` | Bearer | Settle all open orders for a chain. Body: `{ "chainId": 42161, "forceMigration": false }` |
| `POST` | `/settle/order` | Bearer | Settle a single order by ID. Body: `{ "orderId": "...", "chainId": 42161, "forceMigration": false }` |

---

## Supported Protocols

| Protocol | Repay/Withdraw (source) | Deposit/Borrow (destination) |
|----------|------------------------|------------------------------|
| Aave V3 | ✓ | ✓ |
| Compound V3 | ✓ | ✓ |
| Morpho Blue | ✓ | ✓ |
| Silo V2 | ✓ | ✓ |

---

## Supported Chains

| Chain | ID |
|-------|----|
| Arbitrum One | `42161` |

---

## Live Migrations on Arbitrum

All four transactions below were executed by the agent on Arbitrum One. Each one flash-borrows USDT from Morpho Blue, moves the user's collateral and debt atomically to a better-rate protocol, and repays the flash loan in a single `multicall` — no capital at risk.

### Morpho Blue → Compound V3 (wstETH / USDT)
[0xa5fa1b7b...](https://arbiscan.io/tx/0xa5fa1b7bdf27ccf8700f6bdd897c33742d7b7e4bba569300f82852258f283a1a)

Migrated a wstETH-collateral / USDT-borrow position from **Morpho Blue** to **Compound V3** (cUSDTv3).

| Step | Action |
|------|--------|
| 1 | Flash loan 1.3 USDT from Morpho Blue |
| 2 | Repay 1.3 USDT debt on Morpho Blue |
| 3 | Withdraw 0.00123 wstETH collateral from Morpho Blue |
| 4 | Supply 0.00123 wstETH as collateral on Compound V3 |
| 5 | Borrow 1.313 USDT from Compound V3 (repays flash loan + fee) |

---

### Compound V3 → Morpho Blue (wstETH / USDT)
[0xe6fbd29d...](https://arbiscan.io/tx/0xe6fbd29dbf2f8d053b642dc62f1627ca3186b6985127374e009603be3b4f10f2)

Migrated a wstETH-collateral / USDT-borrow position from **Compound V3** to **Morpho Blue** — the reverse of the migration above, executed when Morpho offered a better borrow rate.

| Step | Action |
|------|--------|
| 1 | Flash loan 1.5 USDT from Morpho Blue |
| 2 | Repay 1.5 USDT debt on Compound V3 |
| 3 | Withdraw 0.00123 wstETH collateral from Compound V3 |
| 4 | Supply 0.00123 wstETH as collateral on Morpho Blue |
| 5 | Borrow 1.5 USDT from Morpho Blue (repays flash loan) |

---

### Aave V3 → Compound V3 (wstETH / USDT)
[0x95a88d7b...](https://arbiscan.io/tx/0x95a88d7bdc5894d04d8ff54427613b9a7ffc726cb85067c7d5bbaf40a06372c9)

Migrated a wstETH-collateral / USDT-borrow position from **Aave V3** to **Compound V3**.

| Step | Action |
|------|--------|
| 1 | Flash loan 1.5 USDT from Morpho Blue |
| 2 | Repay 1.5 USDT variable-rate debt on Aave V3 |
| 3 | Withdraw 0.00123 wstETH collateral from Aave V3 (burn aArbwstETH) |
| 4 | Supply 0.00123 wstETH as collateral on Compound V3 |
| 5 | Borrow 1.5 USDT from Compound V3 (repays flash loan) |

---

### Compound V3 → Aave V3 (WETH / USDT)
[0xf00d3adf...](https://arbiscan.io/tx/0xf00d3adfd6aec4cdf925cdfd8519c51a8ca6c75b982209e1fbd5618261e67430)

Migrated a WETH-collateral / USDT-borrow position from **Compound V3** to **Aave V3**.

| Step | Action |
|------|--------|
| 1 | Flash loan ~1 USDT from Morpho Blue |
| 2 | Repay ~1 USDT debt on Compound V3 |
| 3 | Withdraw 0.0006 WETH collateral from Compound V3 |
| 4 | Supply 0.0006 WETH as collateral on Aave V3 (mint aWETH) |
| 5 | Borrow ~1 USDT (variable rate) from Aave V3 (repays flash loan, mint vUSDT) |
