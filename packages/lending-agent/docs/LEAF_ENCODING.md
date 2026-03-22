# Lending Agent — Merkle Leaf Encoding Reference

Each leaf in an order is hashed as:

```
keccak256(encodePacked([uint8 op, uint16 lender, bytes data]))
```

The `data` field is protocol-specific and documented below.

---

## Operation Codes

| Code | Name |
|------|------|
| 0 | DEPOSIT |
| 1 | BORROW |
| 2 | REPAY |
| 3 | WITHDRAW |
| 4 | DEPOSIT_LENDING_TOKEN |
| 5 | WITHDRAW_LENDING_TOKEN |

## Lender ID Ranges

| Range | Protocol |
|-------|----------|
| 0 – 999 | AAVE_V3 |
| 1000 – 1999 | AAVE_V2 |
| 2000 – 2999 | COMPOUND_V3 |
| 3000 – 3999 | COMPOUND_V2 |
| 4000 – 4999 | MORPHO_BLUE |
| 5000 – 5999 | SILO_V2 |

---

## Aave V3

### DEPOSIT (op=0)
```
[20: pool]
```

### BORROW (op=1)
```
[1: mode][20: pool]
```
- `mode`: 1 = stable, 2 = variable (typically 2)

### REPAY (op=2)
```
[1: mode][20: variableDebtToken][20: pool]
```
- `variableDebtToken`: Aave **wrapper** token — NOT the underlying asset
- Call `UNDERLYING_ASSET_ADDRESS()` on it to get the real debt token

### WITHDRAW (op=3)
```
[20: aToken][20: pool]
```
- `aToken`: Aave **wrapper** token — NOT the underlying asset
- Call `UNDERLYING_ASSET_ADDRESS()` on it to get the real collateral token

> **Note**: Neither REPAY nor WITHDRAW encodes the underlying asset address.
> Underlying addresses must be resolved from the position API (`data[0].positions[].underlying`).

---

## Compound V3

### DEPOSIT (op=0)
```
[20: comet]
```

### BORROW (op=1)
```
[20: comet]
```

### REPAY (op=2)
```
[20: comet]
```

### WITHDRAW (op=3)
```
[1: isBase][20: comet]
```
- `isBase`: 0 = collateral asset, 1 = base (debt) asset

> **Note**: Compound V3 leaves only encode the comet proxy address — no token information.
> The base (debt) token and collateral token must be resolved from the position API.
> Multiple markets exist per chain (e.g. `COMPOUND_V3_USDC`, `COMPOUND_V3_WETH`) and are
> distinguished by their comet address, not by the leaf lender ID prefix alone.

---

## Morpho Blue

All ops share the same market params struct. DEPOSIT and REPAY append optional callback data.

### BORROW (op=1) / WITHDRAW (op=3)
```
[20: loanToken][20: collateralToken][20: oracle][20: irm][16: lltv][1: flags][20: morpho]
```
Total: **117 bytes**

### DEPOSIT (op=0) / REPAY (op=2)
```
[20: loanToken][20: collateralToken][20: oracle][20: irm][16: lltv][1: flags][20: morpho][2: cbLen][N: callbackData]
```
Total: **119+ bytes** (cbLen=0 means no callback data)

| Field | Bytes | Description |
|-------|-------|-------------|
| loanToken | 20 | Underlying debt asset (e.g. USDC) — **real underlying, safe to use** |
| collateralToken | 20 | Underlying collateral asset (e.g. WETH) — **real underlying, safe to use** |
| oracle | 20 | Price oracle address |
| irm | 20 | Interest rate model address |
| lltv | 16 | Liquidation loan-to-value (uint128, divide by 1e18 for percentage) |
| flags | 1 | Bitmask for protocol flags |
| morpho | 20 | Morpho Blue core contract address |
| cbLen | 2 | Callback data length (DEPOSIT/REPAY only) |
| callbackData | N | Optional callback payload (DEPOSIT/REPAY only) |

> **Note**: Morpho is the only protocol where the leaf directly encodes the **underlying** token
> addresses. These can be used directly with `find_market` / `get_lending_markets`.

---

## Summary

| Protocol | Has underlying token in leaf? | Key identifier |
|----------|-------------------------------|----------------|
| Aave V3 | No (wrapper tokens only) | `pool` address |
| Compound V3 | No | `comet` address |
| Morpho Blue | **Yes** (`loanToken`, `collateralToken`) | `loanToken:collateralToken` pair |

When resolving underlying token addresses for market lookups:
- **Morpho source**: read `loanToken` and `collateralToken` directly from the leaf
- **Aave / Compound source**: parse `data[0].positions[].underlying` from the position API response, matching by `debt > 0` (debt token) and `collateralEnabled = true` (collateral token)
