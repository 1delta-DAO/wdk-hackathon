// Constants & types
export { LenderOps, LenderIds, FEE_DENOMINATOR, AmountSentinel, SwapAmountSentinel } from './constants.js'
export type { Address } from './constants.js'

// Merkle tree & order definition
export {
  buildLeaf,
  pairHash,
  buildMerkleTree,
  defineOrder,
  verifyMerkleProof,
  AaveData,
  MorphoData,
} from './merkle.js'
export type { LeafParams, ActionDef, MorphoMarketParams } from './merkle.js'

// Calldata encoding
export {
  encodeSettlementData,
  encodeMigrationSettlementData,
  encodeOrderData,
  encodeExecutionData,
  encodeFillerCalldata,
  encodeAaveHealthCondition,
  encodeMorphoHealthCondition,
  encodeCompoundV3HealthCondition,
  encodeSimplePoolHealthCondition,
} from './calldata.js'
export type {
  Conversion,
  AaveCondition,
  MorphoCondition,
  CompoundV3Condition,
  SimplePoolCondition,
  Condition,
  ActionCalldata,
  SwapParams,
} from './calldata.js'

// Batches (health-factor condition expansion)
export {
  expandStableBatchToConditions,
  batchesById,
} from './batches.js'
export type {
  AaveStableBatchMember,
  MorphoStableBatchMember,
  StableHealthBatch,
} from './batches.js'

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

// Permits, signatures & multicall encoding
export {
  // Typed data definitions (for signTypedData)
  PermitTypedData,
  MorphoAuthorizationTypedData,
  CompoundV3AuthorizationTypedData,
  AaveDelegationTypedData,
  SettlementOrderTypedData,
  // Message builders
  buildPermitMessage,
  buildMorphoAuthMessage,
  buildCompoundV3AuthMessage,
  buildAaveDelegationMessage,
  buildSettlementOrderMessage,
  // Domain builders
  permitDomain,
  morphoDomain,
  compoundV3Domain,
  aaveDelegationDomain,
  settlementDomain,
  // Multicall calldata encoders
  encodePermitCall,
  encodeMorphoAuthCall,
  encodeCompoundV3AuthCall,
  encodeAaveDelegationCall,
  // ABI fragments
  multicallAbi,
  settleWithFlashLoanAbi,
} from './permits.js'
export type {
  SplitSignature,
  TypedDataDomain,
  PermitMessage,
  MorphoAuthMessage,
  CompoundV3AuthMessage,
  AaveDelegationMessage,
  SettlementOrderMessage,
} from './permits.js'
