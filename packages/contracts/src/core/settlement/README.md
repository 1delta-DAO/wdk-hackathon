# Settlement Executor — Merkle-Verified Lending Actions

## Overview

The settlement system enables intent-based lending position management across multiple protocols (Aave V2/V3, Compound V2/V3, Morpho Blue, Silo V2). A user signs an order that defines **which** lending actions are permitted. A solver then fills the order by choosing **which** of those approved actions to execute, and with **what** amounts/assets/receivers.

The key insight: the user's order is compact (a single merkle root), while the solver has full autonomy to pick the optimal execution path from the approved action set.

## Architecture

```
┌──────────────────────────────────────────────────┐
│                  Flash Loan Provider              │
│              (Morpho Blue / Moolah)               │
└──────────────────┬───────────────────────────────┘
                   │ callback
                   ▼
┌──────────────────────────────────────────────────┐
│        MorphoSettlementCallback                   │
│        MoolahSettlementCallback                   │
│  - validates caller                               │
│  - extracts origCaller, orderData, executionData  │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│             SettlementExecutor                    │
│  1. pre-actions  (merkle-verified lending ops)    │
│  2. intent       (virtual — swap/fill logic)      │
│  3. post-actions (merkle-verified lending ops)    │
└──────────────────┬───────────────────────────────┘
                   │
                   ▼
┌──────────────────────────────────────────────────┐
│         UniversalSettlementLending                │
│  dispatches to per-lender contracts:              │
│  Aave, Compound, Morpho, Silo                    │
└──────────────────────────────────────────────────┘
```

## Merkle Tree Design

### What the user signs

Each action the user approves becomes a leaf in a merkle tree:

```
leaf = keccak256(op ‖ lender ‖ lenderData)
```

Where:
- `op` (1 byte) — lending operation: deposit(0), borrow(1), repay(2), withdraw(3), etc.
- `lender` (2 bytes) — lender identifier (Aave V3 < 1000, Aave V2 < 2000, Compound V3 < 3000, etc.)
- `lenderData` (variable) — protocol-specific params (pool address, market params, cToken, etc.)

The user's signed order contains only the **merkle root** — a single `bytes32` regardless of how many actions are approved.

### What the solver provides

For each action the solver wants to execute, they supply:
- The **variable params**: asset, amount, receiver
- The **action config**: op, lender, lenderData (must match an approved leaf)
- A **merkle proof**: sibling hashes proving the action is in the tree

The executor verifies the proof on-chain before dispatching.

### Example: User approves 4 destination lenders

```
Leaf 0: deposit to Aave V3 pool 0xAAA...
Leaf 1: deposit to Compound V3 comet 0xBBB...
Leaf 2: deposit to Morpho market {loan, collateral, oracle, irm, lltv, morpho}
Leaf 3: deposit to Silo V2 silo 0xDDD...

        root
       /    \
     h01     h23
    /   \   /   \
  L0    L1 L2   L3
```

The order stores just `root` (32 bytes). The solver picks e.g. Leaf 2 (best rate) and provides a 2-element proof `[L3, h01]`.

## Data Layouts

### Order Data (signed/stored)

```
[32 bytes: merkleRoot]
[2 bytes:  settlementDataLength]
[variable: settlementData]
```

Fixed overhead: 34 bytes + settlement params. The merkle root covers arbitrarily many approved actions.

### Execution Data (solver-provided)

```
[1 byte: numPreActions]
[1 byte: numPostActions]
[per action (pre-actions first, then post-actions)]:
    ┌─ variable params (54 bytes) ──────────┐
    │ [20 bytes: asset address]              │
    │ [14 bytes: amount (uint112)]           │
    │ [20 bytes: receiver address]           │
    ├─ action config (5 + N bytes) ──────────┤
    │ [1 byte:  lendingOperation]            │
    │ [2 bytes: lender]                      │
    │ [2 bytes: lenderDataLength]            │
    │ [N bytes: lenderData]                  │
    ├─ merkle proof ─────────────────────────┤
    │ [1 byte:  proofLength]                 │
    │ [proofLength × 32 bytes: proof nodes]  │
    └────────────────────────────────────────┘
```

### Amount Encoding

Amounts use `uint112` (14 bytes) with sentinel values:
- `0` — use the contract's current balance of the asset
- `type(uint112).max` — protocol-specific "safe max" (e.g., full user balance)

## Execution Flow

```
1. Flash loan provider calls back into the settlement contract
2. Callback validates caller, extracts origCaller from calldata
3. Callback copies orderData and executionData into memory
4. _executeSettlement is called:
   a. Parse merkleRoot from orderData
   b. Parse numPre, numPost from executionData
   c. For each pre-action:
      - Parse (asset, amount, receiver) from executionData
      - Parse (op, lender, lenderData) from executionData
      - Compute leaf hash, verify merkle proof against root
      - Dispatch via _lendingOperations
   d. Call _executeIntent (virtual — swap/fill)
   e. For each post-action: same as (c)
5. Flash loan repayment occurs naturally from contract balance
```

## Lender Data Formats

| Lender | Operation | Data Layout | Size |
|--------|-----------|-------------|------|
| Aave V3 | deposit | `[20: pool]` | 20 |
| Aave V3 | borrow | `[1: mode][20: pool]` | 21 |
| Aave V3 | repay | `[1: mode][20: debtToken][20: pool]` | 41 |
| Aave V3 | withdraw | `[20: aToken][20: pool]` | 40 |
| Compound V3 | deposit/borrow/repay | `[20: comet]` | 20 |
| Compound V3 | withdraw | `[1: isBase][20: comet]` | 21 |
| Compound V2 | all ops | `[20: cToken]` | 20 |
| Silo V2 | deposit/withdraw | `[1: cType][20: silo]` | 21 |
| Silo V2 | borrow | `[1: mode][20: silo]` | 21 |
| Silo V2 | repay | `[20: silo]` | 20 |
| Morpho | borrow/withdraw | `[20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho]` | 117 |
| Morpho | deposit/repay | above + `[2: cbLen][cbLen: cbData]` | 119+ |

## Use Cases

### Leverage Loop

User wants to lever up on Aave — approves deposit + borrow actions:

```
Pre:  deposit USDC collateral on Aave
Intent: swap ETH → USDC (repay flash loan)
Post: borrow ETH from Aave
```

### Cross-Protocol Migration

User wants to move a position from Compound to the best available lender:

```
Approved leaves:
  - withdraw from Compound V3
  - repay on Compound V3
  - deposit on Aave V3 pool A
  - deposit on Morpho market B
  - deposit on Silo pool C
  - borrow on Aave V3 pool A
  - borrow on Morpho market B
  - borrow on Silo pool C

Solver picks Morpho (best rate today):
  Pre:  repay debt on Compound, withdraw collateral from Compound
  Intent: swap if assets differ
  Post: deposit collateral on Morpho, borrow on Morpho
```

The user signed once. The solver optimizes autonomously.

## Gas Characteristics

- Merkle proof verification: ~2,100 gas per proof element (one `keccak256` + comparison)
- Typical proof depth: 2–3 elements for 4–8 approved actions
- Proof overhead per action: ~4,200–6,300 gas
- Lending protocol calls: 50,000–200,000 gas each (dominates total cost)
- Merkle overhead is <5% of total execution cost

## Files

```
settlement/
├── SettlementExecutor.sol              Core executor with merkle verification
├── lending/
│   ├── UniversalSettlementLending.sol  Lending operation dispatcher
│   ├── AaveSettlementLending.sol       Aave V2/V3 operations
│   ├── CompoundV2SettlementLending.sol Compound V2 operations
│   ├── CompoundV3SettlementLending.sol Compound V3 operations
│   ├── MorphoSettlementLending.sol     Morpho Blue operations
│   ├── SiloV2SettlementLending.sol     Silo V2 operations
│   └── DeltaEnums.sol                  Enum definitions
├── flash-loan/
│   ├── Morpho.sol                      Flash loan initiator
│   ├── MorphoSettlementCallback.sol    Morpho callback → executor
│   ├── MoolahSettlementCallback.sol    Moolah callback → executor
│   ├── MorphoCallback.sol              Legacy generic callback
│   └── MoolahCallback.sol              Legacy generic callback
└── README.md
```
