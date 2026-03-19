# contracts

Solidity smart contracts for atomic lending position migrations across DeFi protocols.

## Overview

Users sign an EIP-712 order off-chain that commits to a merkle root of approved lending actions.
A solver (or AI agent) finds the best destination market, then submits one transaction that atomically:

1. Flash-loans the debt asset
2. Repays the user's debt on the source protocol
3. Withdraws the user's collateral from the source protocol
4. (Optional) Swaps assets via an oracle-verified DEX call
5. Deposits collateral on the destination protocol
6. Borrows on the destination protocol to repay the flash loan
7. Checks that all token balances net to zero (or a validated solver fee)
8. (Optional) Verifies the user's health factor is above a signed minimum

The user never loses custody of their position — if any step fails, the entire transaction reverts.

## Deployable Contracts

Settlement is split into an abstract base and chain-specific subcontracts that wire in the
appropriate flash loan provider. All share the same entry points:

- `settle(...)` — direct settlement (no flash loan, for same-asset same-protocol top-ups)
- `settleWithFlashLoan(...)` — flash-loan-wrapped migration

The user signs which asset conversions are allowed:

```
settlementData = [1: numConversions]
                 [per conversion (68 bytes)]: [20: assetIn][20: assetOut][20: oracle][8: swapTolerance]
                 [optional: numConditions + health factor conditions]
```

If `fillerCalldata` is empty, no swap is performed (same-asset migration).

### Chain-specific `Settlement.sol` contracts

| Chain | Path | Flash loan provider |
|-------|------|---------------------|
| Ethereum | `ethereum/Settlement.sol` | Morpho Blue + Moolah (Lista DAO) callbacks |
| Arbitrum | `arbitrum/Settlement.sol` | Morpho Blue only |
| Base | `base/Settlement.sol` | Morpho Blue only |
| BNB Chain | `bnb/Settlement.sol` | Moolah (Lista DAO) only |

Each subcontract overrides `_flashLoan()` to call the chain's provider, and registers only
the flash loan callbacks present on that chain.

### `MigrationSettlement.sol`

Simplified variant for Aave V3 → Aave V3 migrations. No swaps. The intent is an on-chain
borrow rate check: the transaction reverts if the destination rate is not better than the source.
No solver fee (`maxFeeBps = 0`).

## Inheritance

```
SettlementBase (abstract)
  ├── EIP712OrderVerifier       — recovers signer, checks deadline + cancellation
  ├── SwapVerifier              — oracle-checks DEX swap output
  ├── HealthFactorChecker       — checks post-settlement health factors
  └── SettlementExecutor (abstract) — core orchestrator
        └── UniversalSettlementLending   — routes to per-protocol adapters
              ├── AaveSettlementLending
              ├── CompoundV2SettlementLending
              ├── CompoundV3SettlementLending
              ├── MorphoSettlementLending
              └── SiloV2SettlementLending

Settlement (chain-specific, e.g. arbitrum/Settlement.sol)
  ├── SettlementBase
  ├── MorphoFlashLoans          — initiates flash loans (shared interface with Moolah)
  ├── MorphoSettlementCallback  — Morpho Blue callback  (Ethereum, Arbitrum, Base)
  └── MoolahSettlementCallback  — Lista DAO callback    (Ethereum, BNB Chain)
```

## Key Design Decisions

### Merkle-based action authorization

The user signs a 32-byte merkle root, not a list of actions. This gives flexibility:
a single signature can approve migrations to multiple possible destination markets
(e.g. AAVE_V3_CORE, AAVE_V3_PRIME, MORPHO). The solver picks the best one at execution
time and supplies merkle proofs for the chosen leaves.

```
leaf = keccak256(abi.encodePacked(uint8 op, uint16 lender, bytes lenderData))
```

Each leaf commits to exactly one operation on one protocol. The protocol-specific addresses
(pool, aToken, debtToken for Aave; loanToken, oracle, irm, lltv for Morpho) are baked into
the leaf at signing time — the solver cannot substitute different markets.

### Zero-sum delta accounting

Every token that enters the contract during settlement must leave through a valid path.
The executor tracks `AssetDelta { asset, delta, totalBorrowed }` for each token touched:

| Delta state | Outcome |
|-------------|---------|
| `delta < 0` | Revert (`UnbalancedSettlement`) |
| `delta > 0` and borrowed | Solver fee — checked against user-signed `maxFeeBps` |
| `delta > 0` not borrowed | Stays in contract — solver must deposit via post-action |
| `delta == 0` | Balanced, ok |

### Isolated DEX execution

Swaps execute inside `SettlementForwarder` — a minimal contract that has no token
approvals of its own. Tokens are transferred in, the target is called, and output is
swept back. This ensures a malicious swap target cannot drain user approvals.

### Solver fee model

The solver fee is not declared — it is the natural surplus from borrowing slightly more
than what was repaid. Denominator is `1e7` (sub-basis-point precision):

```
100% = 10_000_000  |  1% = 100_000  |  1 bps = 1_000
```

The user signs `maxFeeBps` and the contract enforces: `surplus × 1e7 ≤ totalBorrowed × maxFeeBps`.

Fees can **only** come from borrow operations. Non-borrow surpluses (e.g. swap dust) are
never sent to the solver — they must be re-deposited for the user via post-actions.

## Data Layouts

### Order data (signed by user)

```
[32: merkleRoot][2: settlementDataLength][settlementData]
```

### Execution data (solver-provided)

```
[1: numPre][1: numPost][20: feeRecipient]
[per action]:
    [20: asset][14: amount][20: receiver]         — 54 bytes
    [1: op][2: lender][2: dataLen][lenderData]    — action config
    [1: proofLen][proofLen × 32: siblings]        — merkle proof
```

### Lender IDs and leaf data formats

| Range | Protocol | op=DEPOSIT | op=BORROW | op=REPAY | op=WITHDRAW |
|-------|----------|-----------|-----------|----------|-------------|
| 0–999 | Aave V3 | `[20: pool]` | `[1: mode][20: pool]` | `[1: mode][20: debtToken][20: pool]` | `[20: aToken][20: pool]` |
| 1000–1999 | Aave V2 | same as V3 | same as V3 | same as V3 | same as V3 |
| 2000–2999 | Compound V3 | `[20: comet]` | `[20: comet]` | `[20: comet]` | `[1: isBase][20: comet]` |
| 3000–3999 | Compound V2 | `[1: selectorId][20: cToken]` | `[20: cToken]` | `[20: cToken]` | `[1: selectorId][20: cToken]` |
| 4000–4999 | Morpho Blue | `[20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho][2: cbLen][cb]` | `[20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho]` | same as deposit | same as borrow |
| 5000–5999 | Silo V2 | `[1: cType][20: silo]` | `[1: mode][20: silo]` | `[20: silo]` | `[1: cType][20: silo]` |

### Amount sentinels

| Value | Meaning |
|-------|---------|
| `0` | Contract's current token balance (use after max withdrawals) |
| `type(uint112).max` | Protocol-specific safe max (full user position) |

## Signature-Based Authorizations

Before the migration can execute, the settlement contract needs permission to act on behalf
of the user at each protocol. These authorizations can be bundled into the same transaction
via `multicall`:

| Function | Protocol | Purpose |
|----------|----------|---------|
| `permit` | ERC-2612 | Approve settlement to transfer aTokens |
| `aaveDelegationWithSig` | Aave V3 | Credit delegation to borrow on user's behalf |
| `morphoSetAuthorizationWithSig` | Morpho Blue | Authorize settlement to act on user's Morpho positions |
| `compoundV3AllowBySig` | Compound V3 | Authorize settlement as Comet manager |

All use best-effort semantics (silently succeed if already consumed) so multicall bundles are idempotent.

## Building and Testing

```bash
# Compile
forge build

# Run tests
forge test

# Fork tests (requires RPC)
ETH_RPC_URL=<rpc> forge test --match-path "test/*Fork*"
```

## Detailed Documentation

See [src/core/settlement/README.md](src/core/settlement/README.md) for:
- Step-by-step migration walkthrough with delta accounting
- Complete viem signing examples for all authorization types
- Full data layout reference
- Solver fee examples
