# Settlement System

A gas-efficient, merkle-tree-based intent settlement system for DeFi lending
operations with per-asset zero-sum accounting and borrow-only solver fees.

## Architecture

```
Settlement.sol (external API, EIP-712 signature verification)
  |
  ├── settle()                         — direct settlement
  ├── settleWithFlashLoan()            — flash-loan-wrapped settlement
  |
  ├── SettlementExecutor.sol           — core executor
  │   ├── _executeSettlement()         — orchestrates pre → intent → post → fee → verify
  │   ├── _executeActions()            — loops actions, verifies merkle proofs
  │   ├── _sweepFeesAndVerify()        — borrow-only fee sweep + zero-sum check
  │   └── _executeIntent()             — virtual hook for swaps
  |
  ├── EIP712OrderVerifier.sol          — signature recovery + deadline check
  |
  ├── MorphoSettlementCallback.sol     — Morpho Blue flash loan callback
  ├── MoolahSettlementCallback.sol     — Lista DAO flash loan callback
  ├── MorphoFlashLoans (Morpho.sol)    — flash loan initiator
  |
  ├── lending/
  │   ├── UniversalSettlementLending   — routes to per-lender contracts
  │   ├── AaveSettlementLending        — Aave V2/V3
  │   ├── CompoundV2SettlementLending  — Compound V2 / Venus
  │   ├── CompoundV3SettlementLending  — Compound V3 (Comet)
  │   ├── MorphoSettlementLending      — Morpho Blue
  │   ├── SiloV2SettlementLending      — Silo V2
  │   ├── DepositBalanceFetcher        — read-only deposit balance queries
  │   └── BorrowBalanceFetcher         — read-only borrow balance queries
  |
  └── SettlementForwarder.sol          — isolated DEX execution sandbox
```

---

## Position Migration — Step by Step

The most common use case: migrate a user's borrow position from one lending
pool to another (e.g. Aave V3 Prime -> Aave V3 Core) in a single atomic
transaction, using a flash loan to temporarily cover the debt.

### Actors

- **User** — owns the lending position, signs the order off-chain
- **Solver** — submits the transaction, chooses the route, earns a fee
- **Settlement contract** — executes the migration, enforces invariants

### Pre-conditions

The user has, for example:
- 10 WETH deposited as collateral on Aave V3 Prime
- 1 000 USDC borrowed on Aave V3 Prime

The user wants to migrate to Aave V3 Core (lower borrow rate) and is willing
to pay up to 0.5% fee on the borrowed amount to the solver.

### Step 1: User signs the order (off-chain)

The user constructs a merkle tree of approved lending actions:

```
Leaf 0:  repay(USDC, mode=2, debtToken=vUSDC_prime, pool=Prime)
Leaf 1:  withdraw(WETH, aToken=aWETH_prime, pool=Prime)
Leaf 2:  deposit(WETH, pool=Core)
Leaf 3:  borrow(USDC, mode=2, pool=Core)

         root           <- user signs this (32 bytes)
        /    \
      h01     h23
     /   \   /   \
   L0    L1 L2   L3
```

The user signs an EIP-712 typed message containing:

```
MigrationOrder {
    merkleRoot:     bytes32     — the root above
    deadline:       uint48      — order expiry timestamp
    settlementData: bytes       — intent parameters (empty for same-asset migration)
}
```

The signature also commits to `maxFeeBps` — the maximum fee percentage the
user allows.  This is passed as a parameter at call time and verified by the
contract.

### Step 2: Solver submits the transaction

The solver calls:

```solidity
settlement.settleWithFlashLoan(
    flashLoanAsset:  USDC,
    flashLoanAmount: 1_000_000_001,     // slightly more than debt to cover rounding
    flashLoanPool:   MORPHO_BLUE,
    poolId:          0,
    maxFeeBps:       50_000,            // 0.5% (in 1e7 denomination)
    deadline:        <from signature>,
    signature:       <user's EIP-712 sig>,
    orderData:       <merkleRoot + settlementData>,
    executionData:   <actions + proofs>,
    fillerCalldata:  ""                 // empty = no swap needed
);
```

### Step 3: Execution flow inside the contract

```
                          Settlement Contract
                          ══════════════════

  ┌─ EIP-712 Verification ───────────────────────────────────────┐
  │  1. Recover signer from signature                            │
  │  2. Check deadline not expired                               │
  │  3. signer = user (position owner for all lending ops)       │
  └──────────────────────────────────────────────────────────────┘
                              │
  ┌─ Flash Loan ─────────────────────────────────────────────────┐
  │  4. Morpho flash-loans 1 000.000001 USDC to contract         │
  └──────────────────────────────────────────────────────────────┘
                              │
  ┌─ Stage 1: Pre-Actions ───────────────────────────────────────┐
  │                                                              │
  │  Action A — Repay debt on source pool                        │
  │    • Verify merkle proof for Leaf 0                          │
  │    • repay(USDC, max, user, mode=2, debtToken, Prime)        │
  │    • Resolves to min(contractBalance, userDebt)              │
  │    • Sends 1 000.000001 USDC to Aave Prime                  │
  │    → delta[USDC] = −1 000 000 001                           │
  │    → amountIn = 1 000 000 001                               │
  │                                                              │
  │  Action B — Withdraw collateral from source pool             │
  │    • Verify merkle proof for Leaf 1                          │
  │    • withdraw(WETH, max, settlement, aToken, Prime)          │
  │    • Resolves to user's full aWETH balance                   │
  │    • Receives ~10 WETH from Aave Prime                       │
  │    → delta[WETH] = +9 999 999 999 999 999 998               │
  │    → amountOut = 9 999 999 999 999 999 998                  │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘
                              │
  ┌─ Stage 2: Intent ────────────────────────────────────────────┐
  │                                                              │
  │  fillerCalldata is empty → no-op                             │
  │  (Same-asset migration: WETH stays WETH, USDC stays USDC)   │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘
                              │
  ┌─ Stage 3: Post-Actions ──────────────────────────────────────┐
  │                                                              │
  │  Action C — Deposit collateral to destination pool           │
  │    • Verify merkle proof for Leaf 2                          │
  │    • deposit(WETH, 0=contractBalance, user, Core)            │
  │    • Sends ~10 WETH to Aave Core                             │
  │    → delta[WETH] = 0  ✓                                     │
  │    → amountIn = 9 999 999 999 999 999 998                   │
  │                                                              │
  │  Action D — Borrow from destination pool                     │
  │    • Verify merkle proof for Leaf 3                          │
  │    • borrow(USDC, 1_000_000_002, settlement, mode=2, Core)  │
  │    • Receives 1 000.000002 USDC from Aave Core              │
  │    → delta[USDC] = −1 000 000 001 + 1 000 000 002 = +1     │
  │    → amountOut = 1 000 000 002                              │
  │    → totalBorrowed[USDC] = 1 000 000 002                    │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘
                              │
  ┌─ Stage 4: Fee Sweep ─────────────────────────────────────────┐
  │                                                              │
  │  WETH delta = 0  → balanced, skip                            │
  │  USDC delta = +1 → positive surplus:                         │
  │    1. Was USDC borrowed? totalBorrowed = 1 000 000 002 > 0 ✓│
  │    2. Fee check: 1 × 1e7 ≤ 1 000 000 002 × 50 000?         │
  │       10 000 000 ≤ 50 000 000 100 000  ✓                    │
  │    3. Transfer 1 wei USDC to solver (feeRecipient)           │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘
                              │
  ┌─ Stage 5: Zero-Sum Verification ─────────────────────────────┐
  │                                                              │
  │  WETH delta = 0  ✓                                          │
  │  USDC delta = 0  ✓  (surplus was swept as fee)              │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘
                              │
  ┌─ Flash Loan Repayment ───────────────────────────────────────┐
  │                                                              │
  │  Morpho takes 1 000.000001 USDC from contract (fee-free)    │
  │  Contract USDC balance: 0                                    │
  │                                                              │
  └──────────────────────────────────────────────────────────────┘
```

### Result

```
                    Before              After
                    ──────              ─────
Prime aWETH:        10.0 WETH           0
Prime USDC debt:    1 000.000001 USDC   0
Core  aWETH:        0                   ~10.0 WETH
Core  USDC debt:    0                   1 000.000002 USDC
Solver received:    0                   1 wei USDC
```

---

## Solver Fee Mechanism

### How it works

The fee is **not** declared explicitly by the solver.  Instead, it is the
**natural surplus** that results from borrowing slightly more than what was
repaid.  The executor detects this surplus, validates it, and transfers it.

```
repaid debt     = X
borrowed amount = X + fee
flash loan cost = X  (Morpho flash loans are fee-free)
solver receives = fee
```

### Structural guarantees

Fees can **only** come from borrow operations.  This is enforced at the
data-structure level:

```solidity
struct AssetDelta {
    address asset;
    int256  delta;           // net token flow
    uint256 totalBorrowed;   // gross borrow amount (fee denominator)
}
```

Each lending operation updates the delta.  Only `BORROW` operations increment
`totalBorrowed`.  During the fee sweep:

| Condition | Action |
|-----------|--------|
| `delta > 0` and `totalBorrowed > 0` | Fee — transfer surplus to solver |
| `delta > 0` and `totalBorrowed == 0` | **Revert** — non-borrow surplus is invalid |
| `delta < 0` | **Revert** — deficit |
| `delta == 0` | Balanced — ok |

A surplus from a withdrawal, deposit, or repayment is structurally impossible
to extract as a fee.  The solver can only profit from intentional borrow excess.

### Percentage-based cap

The fee is capped as a percentage of the total amount borrowed for each asset.
The user signs `maxFeeBps` with sub-basis-point precision:

```
Denominator = 1e7

100%     = 10 000 000
1%       =    100 000
1 bps    =      1 000
0.01 bps =         10
```

The check (no division, overflow-safe):

```
surplus × 1e7  ≤  totalBorrowed × maxFeeBps
```

**Example**: `maxFeeBps = 50 000` (0.5%), borrow 10 000 USDC:

```
max fee = 10 000 × 50 000 / 1e7 = 50 USDC
```

If the solver borrows 10 050 USDC (to repay 10 000 and keep 50), the check
passes.  If they try 10 051 USDC, it reverts with `FeeExceedsMax()`.

### Fee-free settlements

Set `maxFeeBps = 0`.  Any borrow surplus — even 1 wei — will revert.  This is
what `MigrationSettlement` uses for simple APR-validated migrations where no
solver compensation is needed.

---

## Merkle-Based Action Verification

Users sign an order containing a **merkle root** of all lending actions they
approve.  Solvers choose which actions to execute and provide merkle proofs.

### Why Merkle Trees?

1. **User flexibility** — approve migration to N lenders in a single signature
2. **Solver autonomy** — solver picks the best destination based on current rates
3. **Compact orders** — 32-byte root regardless of how many actions approved
4. **Security** — only user-approved action configurations can execute
5. **Separated concerns** — fixed params (pool addresses) are in the leaf;
   variable params (amounts, receiver) are solver-provided and validated by
   zero-sum accounting

### Leaf construction

```
leaf = keccak256(abi.encodePacked(uint8 op, uint16 lender, bytes lenderData))
```

### Proof verification (sorted-pair hashing)

```
parent = keccak256(min(a, b) ++ max(a, b))
```

Position in the tree is irrelevant — a leaf at any index can be used as a
pre-action or post-action.

---

## EIP-712 Signature Verification

The user signs a `MigrationOrder` struct:

```solidity
MigrationOrder {
    bytes32 merkleRoot,
    uint48  deadline,
    bytes   settlementData
}
```

- **merkleRoot** — covers all approved lending actions
- **deadline** — order expiry (block.timestamp must be ≤ deadline)
- **settlementData** — intent parameters (swap constraints, APR check config, etc.)

The contract recovers the signer via `ecrecover` and uses it as the position
owner (`callerAddress`) for all lending operations.  This ensures:

- Only the signer's positions can be touched
- A wrong signature → wrong signer → lending ops revert (no approvals)
- Expired orders are rejected before any state changes

---

## Data Layouts

### Order Data (signed by user)

```
[32: merkleRoot][2: settlementDataLength][settlementData]
```

### Execution Data (solver-provided)

```
[1: numPre][1: numPost][20: feeRecipient]
[per action]:
    [20: asset][14: amount][20: receiver]         — variable params (54 B)
    [1: op][2: lender][2: dataLen][data]          — action config
    [1: proofLen][proofLen × 32: proof siblings]  — merkle proof
```

### Flash Loan Callback Data

```
[20: origCaller][1: poolId][8: maxFeeBps (uint64)]
[2: orderDataLen][orderData]
[2: fillerCalldataLen][fillerCalldata]
[remaining: executionData]
```

### Amount Sentinels

| Value | Meaning |
|-------|---------|
| `0` | Contract's current balance of the asset |
| `type(uint112).max` | Protocol-specific "safe max" (full user position) |

### Lender Data Formats

| Lender | Operation | Data Layout | Size |
|--------|-----------|-------------|------|
| Aave V3 | deposit | `[20: pool]` | 20 |
| Aave V3 | borrow | `[1: mode][20: pool]` | 21 |
| Aave V3 | repay | `[1: mode][20: debtToken][20: pool]` | 41 |
| Aave V3 | withdraw | `[20: aToken][20: pool]` | 40 |
| Compound V3 | deposit/borrow/repay | `[20: comet]` | 20 |
| Compound V3 | withdraw | `[1: isBase][20: comet]` | 21 |
| Compound V2 | borrow/repay | `[20: cToken]` | 20 |
| Compound V2 | deposit/withdraw | `[1: selectorId][20: cToken]` | 21 |
| Silo V2 | deposit/withdraw | `[1: cType][20: silo]` | 21 |
| Silo V2 | borrow | `[1: mode][20: silo]` | 21 |
| Silo V2 | repay | `[20: silo]` | 20 |
| Morpho | borrow/withdraw | `[20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho]` | 117 |
| Morpho | deposit/repay | above + `[2: cbLen][cbLen: cbData]` | 119+ |

---

## Files

```
settlement/
├── Settlement.sol                      External API + EIP-712 + DEX intent
├── MigrationSettlement.sol             Aave V3 APR-validated migration
├── SettlementExecutor.sol              Core: merkle verify + delta accounting + fee sweep
├── SettlementForwarder.sol             Isolated DEX execution sandbox
├── EIP712OrderVerifier.sol             Signature recovery + deadline check
├── apr/
│   ├── AaveV3AprChecker.sol            Borrow rate comparison
│   └── IAaveV3Pool.sol                 Aave V3 pool interface
├── lending/
│   ├── UniversalSettlementLending.sol  Lending router (returns assetUsed + amounts)
│   ├── AaveSettlementLending.sol       Aave V2/V3 operations
│   ├── CompoundV2SettlementLending.sol Compound V2 / Venus / dForce operations
│   ├── CompoundV3SettlementLending.sol Compound V3 (Comet) operations
│   ├── MorphoSettlementLending.sol     Morpho Blue operations
│   ├── SiloV2SettlementLending.sol     Silo V2 operations
│   ├── DepositBalanceFetcher.sol       Read-only deposit balance queries
│   ├── BorrowBalanceFetcher.sol        Read-only borrow balance queries
│   └── DeltaEnums.sol                  Lender IDs, op types, command enums
├── flash-loan/
│   ├── Morpho.sol                      Flash loan initiator
│   ├── MorphoSettlementCallback.sol    Morpho Blue callback → executor
│   ├── MoolahSettlementCallback.sol    Lista DAO callback → executor
│   ├── MorphoCallback.sol              Legacy generic callback
│   └── MoolahCallback.sol              Legacy generic callback
└── README.md                           This file
```
