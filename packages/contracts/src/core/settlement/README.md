# Settlement System

A gas-efficient, merkle-tree-based intent settlement system for DeFi lending operations.

## Architecture

```
Settlement.sol (external API)
  ├── settle()                         — direct settlement
  ├── settleWithFlashLoan()            — flash-loan-wrapped settlement
  │
  ├── SettlementExecutor.sol           — merkle-verified action dispatch
  │   ├── _executeSettlement()         — orchestrates pre → intent → post
  │   ├── _executeActions()            — loops actions, verifies proofs
  │   └── _executeIntent()             — swap via forwarder
  │
  ├── MorphoSettlementCallback.sol     — Morpho Blue flash loan callback
  ├── MoolahSettlementCallback.sol     — Lista DAO flash loan callback
  ├── MorphoFlashLoans (Morpho.sol)    — flash loan initiator
  │
  ├── lending/
  │   ├── UniversalSettlementLending   — routes to per-lender contracts
  │   ├── AaveSettlementLending        — Aave V2/V3
  │   ├── CompoundV2SettlementLending  — Compound V2 / Venus
  │   ├── CompoundV3SettlementLending  — Compound V3
  │   ├── MorphoSettlementLending      — Morpho Blue
  │   └── SiloV2SettlementLending      — Silo V2
  │
  └── SettlementForwarder.sol          — isolated execution sandbox
```

## Merkle-Based Action Verification

Users sign an order containing a **merkle root** of all lending actions they approve. Solvers choose which actions to execute and provide merkle proofs.

### Why Merkle Trees?

- **User flexibility**: Approve migration to any of N lenders in a single signature
- **Solver autonomy**: Solver picks the best destination(s) based on current rates/liquidity
- **Compact orders**: Order size is constant (32-byte root) regardless of how many actions are approved
- **Security**: Only user-approved action configurations can execute

### Leaf Construction

Each leaf represents an approved action configuration:

```
leaf = keccak256(abi.encodePacked(uint8 op, uint16 lender, bytes lenderData))
```

- `op`: lending operation (0=deposit, 1=borrow, 2=repay, 3=withdraw, 4=deposit_lending_token, 5=withdraw_lending_token)
- `lender`: lender ID (Aave V3 < 1000, Aave V2 < 2000, Compound V3 < 3000, Compound V2 < 4000, Morpho < 5000, Silo V2 < 6000)
- `lenderData`: protocol-specific parameters (pool address, market params, cToken, etc.)

### Proof Verification (sorted-pair hashing)

```
if leaf < sibling:
    node = keccak256(leaf, sibling)
else:
    node = keccak256(sibling, leaf)
```

Repeat up the tree until the computed root matches the signed root.

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

`settlementData` encodes intent parameters:
```
[20: inputToken][14: inputAmount][20: outputToken][14: minOutputAmount]
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
    │ [proofLength x 32 bytes: proof nodes]  │
    └────────────────────────────────────────┘
```

### Filler Calldata (solver's DEX/swap calldata)

```
[20: target (address)]
[remaining: calldata to forward to target]
```

### Amount Encoding

Amounts use `uint112` (14 bytes) with sentinel values:
- `0` — use the contract's current balance of the asset
- `type(uint112).max` — protocol-specific "safe max" (e.g., full user balance)

## Settlement Flows

### 1. Direct Settlement (`settle`)

For operations that don't need flash loans (e.g., withdraw -> swap -> deposit):

```
Solver calls settle(callerAddress, orderData, executionData, fillerCalldata)
  -> pre-actions (merkle-verified lending ops)
  -> intent (swap via forwarder)
  -> post-actions (merkle-verified lending ops)
```

### 2. Flash-Loan Settlement (`settleWithFlashLoan`)

For operations requiring upfront capital (e.g., leverage loops, migrations):

```
Solver calls settleWithFlashLoan(callerAddress, asset, amount, pool, poolId, orderData, executionData, fillerCalldata)
  -> morphoFlashLoan(asset, amount, ...)
    -> callback: onMorphoFlashLoan
      -> pre-actions
      -> intent (swap via forwarder)
      -> post-actions
  -> flash loan repayment (automatic)
```

### Flash Loan Callback Data Layout

```
[20: origCaller][1: poolId]
[2: orderDataLen][orderData]
[2: fillerCalldataLen][fillerCalldata]
[remaining: executionData]
```

## Forwarder Security Model

The `SettlementForwarder` contract provides an isolated execution context for solver-provided calldata:

- **No token approvals**: The forwarder holds no approvals, so malicious calldata cannot call `transferFrom` to drain user funds
- **Restricted access**: `execute()` and `sweep()` are only callable by the Settlement contract
- **Stateless**: No storage, no persistent balances — tokens flow through transiently

Intent execution flow:
1. Settlement contract transfers input tokens to forwarder
2. Forwarder executes solver's calldata (e.g., DEX swap)
3. Settlement contract calls `forwarder.sweep(outputToken)` to pull results back
4. Settlement contract verifies `balAfter - balBefore >= minOutputAmount`

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

## Example: Position Migration

User has a borrow position on Compound V3 and wants to allow migration to any of Aave V3, Morpho Blue, or Silo V2.

**Order** (signed once):
- Merkle tree with 6 leaves:
  - `repay(Compound V3, comet)` — repay existing debt
  - `withdraw(Compound V3, comet)` — withdraw collateral
  - `deposit(Aave V3, pool)` — deposit to Aave
  - `borrow(Aave V3, mode + pool)` — borrow from Aave
  - `deposit(Morpho, marketParams)` — deposit to Morpho
  - `borrow(Morpho, marketParams)` — borrow from Morpho
- `settlementData` = swap parameters
- Order contains just the 32-byte merkle root

**Execution** (solver picks best destination):
```
settleWithFlashLoan(user, USDC, 10000e6, morphoPool, 0, orderData, executionData, dexSwapCalldata)
```

Solver chooses Aave (best rate today):
1. Flash loan USDC
2. Pre-action: repay Compound debt (proof verified)
3. Pre-action: withdraw Compound collateral (proof verified)
4. Intent: swap collateral if needed (via forwarder)
5. Post-action: deposit collateral to Aave (proof verified)
6. Post-action: borrow USDC from Aave to repay flash loan (proof verified)

Tomorrow, rates change — solver picks Morpho instead, using the same signed order with different proofs.

## Gas Characteristics

- Merkle proof verification: ~2,100 gas per proof element (one `keccak256` + comparison)
- Typical proof depth: 2-3 elements for 4-8 approved actions
- Proof overhead per action: ~4,200-6,300 gas
- Lending protocol calls: 50,000-200,000 gas each (dominates total cost)
- Merkle overhead is <5% of total execution cost

## Files

```
settlement/
├── Settlement.sol                     Concrete contract with external API
├── SettlementExecutor.sol             Core executor with merkle verification
├── SettlementForwarder.sol            Isolated execution sandbox
├── lending/
│   ├── UniversalSettlementLending.sol Lending operation dispatcher
│   ├── AaveSettlementLending.sol      Aave V2/V3 operations
│   ├── CompoundV2SettlementLending.sol Compound V2 operations
│   ├── CompoundV3SettlementLending.sol Compound V3 operations
│   ├── MorphoSettlementLending.sol    Morpho Blue operations
│   ├── SiloV2SettlementLending.sol    Silo V2 operations
│   └── DeltaEnums.sol                 Enum definitions
├── flash-loan/
│   ├── Morpho.sol                     Flash loan initiator
│   ├── MorphoSettlementCallback.sol   Morpho callback -> executor
│   ├── MoolahSettlementCallback.sol   Moolah callback -> executor
│   ├── MorphoCallback.sol             Legacy generic callback
│   └── MoolahCallback.sol             Legacy generic callback
└── README.md
```
