# USDT007 Frontend

React + Wagmi UI for USDT007 — Permission to Fill. Lets users connect their wallet, view their active lending positions, and grant agents permission to fill extended intents via the Tether WDK.

---

## What It Does

1. **Connect wallet** — MetaMask, WalletConnect, Coinbase Wallet via RainbowKit/Wagmi
2. **View positions** — fetches the user's live collateral and debt balances from the 1delta portal API (via the portal proxy)
3. **Select migration** — choose source protocol + collateral/debt tokens, destination protocols the user is willing to accept
4. **Generate permits** — collects all required off-chain signatures:
   - ERC-2612 permit for aToken transfers (Aave)
   - Aave credit delegation (`aaveDelegationWithSig`)
   - Morpho Blue authorization (`morphoSetAuthorizationWithSig`)
   - Compound V3 manager allow (`compoundV3AllowBySig`)
5. **Sign order** — builds a Merkle tree over all authorized leaf operations, signs the EIP-712 order root with `maxFeeBps` and deadline
6. **Submit** — POSTs the signed order + all permits to the order backend

---

## Stack

- React 19 + TypeScript
- Vite
- [Wagmi v2](https://wagmi.sh) + [RainbowKit](https://www.rainbowkit.com)
- [1delta settlement-sdk](../settlement-sdk/) for Merkle tree construction and EIP-712 helpers
- DaisyUI for styling

---

## Setup

```bash
cd packages/frontend
pnpm install
```

### Environment variables

Copy `.env.example` to `.env` and fill in:

```bash
VITE_ORDER_BACKEND_URL=https://order-backend.your-worker.workers.dev
VITE_PORTAL_PROXY_URL=https://portal-proxy.your-worker.workers.dev
VITE_WALLETCONNECT_PROJECT_ID=<your WalletConnect project ID>
```

### Run locally

```bash
pnpm dev
```

### Build

```bash
pnpm build
```

---

## Key Components

| File/Component | Purpose |
|---------------|---------|
| `App.tsx` | Root — chain selector, position fetching, full order flow |
| `components/LenderList.tsx` | Protocol + token selector for source and destinations |
| `components/PermissionPanel.tsx` | Displays and collects protocol-specific permit signatures |
| `components/MerklePanel.tsx` | Shows the generated Merkle root and leaf breakdown |
| `components/UserPositions.tsx` | Live position balances fetched from 1delta portal |
| `hooks/usePermitSignatures.ts` | Collects all EIP-712 signatures (permit, delegation, auth) |
| `hooks/useOrderSubmission.ts` | POSTs the final signed order to the order backend |
| `hooks/useUserPositions.ts` | Fetches current positions via portal proxy |
| `data/lenders.ts` | Protocol/token metadata: Aave pools, Compound comets, Morpho markets |
| `lib/merkle.ts` | Maps protocols to lender IDs and builds Merkle leaves |
| `config/settlements.ts` | Settlement contract addresses per chain |

---

## Supported Chains

| Chain | ID |
|-------|----|
| Arbitrum One | `42161` |
