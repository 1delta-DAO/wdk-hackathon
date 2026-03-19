# @1delta/settlement-sdk

Calldata builder for 1delta settlement operations — migrations, collateral swaps, debt swaps, position closes, and cross-protocol migrations.

Produces the exact byte sequences consumed by the on-chain settlement contract: `orderData` (user-signed), `executionData` (solver-provided), and `fillerCalldata` (swap execution).

## Install

```bash
npm install @1delta/settlement-sdk
```

Single runtime dependency: **viem ^2.27**.

## Quick start

```ts
import {
  Settlement,
  buildSettlementOrderMessage,
  settlementDomain,
  SettlementOrderTypedData,
} from '@1delta/settlement-sdk'

// 1. Build the settlement calldata
const result = Settlement.buildCollateralSwap({
  collateralIn: WETH,
  collateralOut: WBTC,
  debtAsset: USDC,
  pool: { pool: POOL, aToken: A_WETH, debtToken: V_USDC, aTokenOut: A_WBTC },
  oracle: ORACLE,
  swapTolerance: 50_000n, // 0.5%
  user: USER,
  settlement: SETTLEMENT,
  borrowAmount: 500_000_000n,
  swap: { amountIn: 0n, target: DEX, calldata: '0x...' },
})

// 2. Build the EIP-712 message the user signs
const message = buildSettlementOrderMessage({
  merkleRoot: result.merkleRoot,
  deadline: Math.floor(Date.now() / 1000) + 3600,
  settlementData: result.settlementData,
})
const domain = settlementDomain({ chainId: 1, settlement: SETTLEMENT })

// 3. Sign with any EIP-712 wallet
const signature = await wallet.signTypedData({
  domain,
  ...SettlementOrderTypedData,
  message,
})

// 4. Submit to the settlement contract
await contract.write.settleWithFlashLoan([
  flashLoanAsset,
  flashLoanAmount,
  flashLoanPool,
  poolId,
  maxFeeBps,
  message.deadline,
  signature,
  result.orderData,
  result.executionData,
  result.fillerCalldata,
])
```

## Settlement builders

All builders live in the `Settlement` namespace and return `Settlement.Result`:

```ts
interface Result {
  orderData: Hex        // merkleRoot + settlementData (packed)
  executionData: Hex    // pre/post actions with merkle proofs
  fillerCalldata: Hex   // DEX swap instructions (or '0x')
  merkleRoot: Hex       // 32-byte root for signing
  settlementData: Hex   // raw settlement data for signing
}
```

| Builder | Use case |
|---|---|
| `Settlement.buildMigration` | Same-asset position migration between Aave pools |
| `Settlement.buildSimpleMigration` | Migration with on-chain APR validation |
| `Settlement.buildCollateralSwap` | Swap collateral while maintaining debt |
| `Settlement.buildDebtSwap` | Swap debt asset while maintaining collateral |
| `Settlement.buildClosePosition` | Repay all debt and withdraw all collateral |
| `Settlement.buildCrossProtocolMigration` | Migrate from Aave to Morpho Blue |

## Permits & signatures

The SDK provides typed-data definitions and message builders for all signature types needed during settlement:

| Typed data | Message builder | Use |
|---|---|---|
| `SettlementOrderTypedData` | `buildSettlementOrderMessage` | The main order signature |
| `PermitTypedData` | `buildPermitMessage` | ERC-2612 token approvals |
| `AaveDelegationTypedData` | `buildAaveDelegationMessage` | Aave V3 credit delegation |
| `MorphoAuthorizationTypedData` | `buildMorphoAuthMessage` | Morpho Blue authorization |
| `CompoundV3AuthorizationTypedData` | `buildCompoundV3AuthMessage` | Compound V3 manager approval |

Domain builders: `settlementDomain`, `permitDomain`, `aaveDelegationDomain`, `morphoDomain`, `compoundV3Domain`.

Multicall encoders for batching permits with settlement: `encodePermitCall`, `encodeAaveDelegationCall`, `encodeMorphoAuthCall`, `encodeCompoundV3AuthCall`.

## Merkle tree

Orders are committed via a merkle root. Each leaf is `keccak256(abi.encodePacked(op, lender, data))`.

```ts
import { defineOrder, buildLeaf, verifyMerkleProof } from '@1delta/settlement-sdk'

const { root, leaves, proofs } = defineOrder([
  { op: LenderOps.REPAY,    lender: 0, data: repayData },
  { op: LenderOps.WITHDRAW, lender: 0, data: withdrawData },
])

// Verify a proof
verifyMerkleProof(leaves[0], proofs[0], root) // true
```

Lower-level helpers: `buildLeaf`, `pairHash`, `buildMerkleTree`.

## Calldata encoding

Individual encoding functions for advanced use:

- `encodeOrderData(merkleRoot, settlementData?)` — user-signed order blob
- `encodeExecutionData(preActions, postActions, feeRecipient?)` — solver execution plan
- `encodeFillerCalldata(swaps)` — DEX swap instructions
- `encodeSettlementData(conversions, conditions?)` — oracle + health factor checks
- `encodeMigrationSettlementData(sourcePool, destPool, borrowAsset)` — APR migration check

## Health-factor conditions

Conditions enforce post-settlement health factor minimums. Per-protocol encoders:

```ts
import {
  encodeAaveHealthCondition,
  encodeMorphoHealthCondition,
  encodeCompoundV3HealthCondition,
  encodeSimplePoolHealthCondition,
} from '@1delta/settlement-sdk'
```

For batch expansion (multiple markets in one check):

```ts
import { expandStableBatchToConditions, batchesById } from '@1delta/settlement-sdk'
```

## Constants

```ts
import { LenderOps, LenderIds, AmountSentinel, FEE_DENOMINATOR } from '@1delta/settlement-sdk'

LenderOps.DEPOSIT   // 0
LenderOps.BORROW    // 1
LenderOps.REPAY     // 2
LenderOps.WITHDRAW  // 3

LenderIds.UP_TO_AAVE_V3      // 1000
LenderIds.UP_TO_MORPHO       // 5000

AmountSentinel.BALANCE  // 0n  — use contract balance
AmountSentinel.MAX      // 2^112 - 1 — use full user position
```

## Module structure

```
src/
  constants.ts    — opcodes, lender IDs, sentinels
  merkle.ts       — leaf/tree construction, AaveData/MorphoData helpers
  calldata.ts     — binary encoding for order/execution/filler/settlement data
  settlement.ts   — Settlement namespace with all high-level builders
  batches.ts      — health-factor batch expansion
  permits.ts      — EIP-712 typed data, domain/message builders, multicall encoders
  index.ts        — barrel re-exports
```

## Development

```bash
npm test          # vitest run
npm run test:watch
npm run build     # tsc
```
