/** Lending operation opcodes — must match DeltaEnums.sol LenderOps */
export const LenderOps = {
  DEPOSIT: 0,
  BORROW: 1,
  REPAY: 2,
  WITHDRAW: 3,
  DEPOSIT_LENDING_TOKEN: 4,
  WITHDRAW_LENDING_TOKEN: 5,
} as const

/** Lender ID ranges — exclusive upper bounds, must match DeltaEnums.sol LenderIds */
export const LenderIds = {
  UP_TO_AAVE_V3: 1000,
  UP_TO_AAVE_V2: 2000,
  UP_TO_COMPOUND_V3: 3000,
  UP_TO_COMPOUND_V2: 4000,
  UP_TO_MORPHO: 5000,
  UP_TO_SILO_V2: 6000,
} as const

/** Fee denominator — 100% = 1e7, 1 bps = 1000 */
export const FEE_DENOMINATOR = 10_000_000n

/** Amount sentinels for lending actions */
export const AmountSentinel = {
  /** Use contract's current token balance */
  BALANCE: 0n,
  /** Use protocol-specific maximum (full user position) */
  MAX: (1n << 112n) - 1n,
} as const

/** Amount sentinel for swap amountIn */
export const SwapAmountSentinel = {
  /** Use contract's full balance of assetIn */
  BALANCE: 0n,
} as const

export type Address = `0x${string}`
