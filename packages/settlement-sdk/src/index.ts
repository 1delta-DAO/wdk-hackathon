// Constants & types
export { LenderOps, LenderIds, FEE_DENOMINATOR, AmountSentinel, SwapAmountSentinel } from './constants.js'
export type { Address } from './constants.js'

// Merkle tree & order definition
export { buildLeaf, pairHash, buildMerkleTree, defineOrder, AaveData, MorphoData } from './merkle.js'
export type { LeafParams, ActionDef, MorphoMarketParams } from './merkle.js'

// Calldata encoding
export {
  encodeSettlementData,
  encodeMigrationSettlementData,
  encodeOrderData,
  encodeExecutionData,
  encodeFillerCalldata,
} from './calldata.js'
export type {
  Conversion,
  AaveCondition,
  MorphoCondition,
  Condition,
  ActionCalldata,
  SwapParams,
} from './calldata.js'

// High-level flow builders
export {
  buildMigration,
  buildSimpleMigration,
  buildCollateralSwap,
  buildDebtSwap,
  buildClosePosition,
  buildCrossProtocolMigration,
} from './flows.js'
export type {
  AavePool,
  SettlementResult,
  MigrationParams,
  SimpleMigrationParams,
  CollateralSwapParams,
  DebtSwapParams,
  ClosePositionParams,
  CrossProtocolMigrationParams,
} from './flows.js'
