import { encodePacked, concatHex, type Hex } from 'viem'
import type { Address } from './constants.js'
import { AmountSentinel } from './constants.js'

// ═══════════════════════════════════════════════════════════
//  Settlement Data (user-signed)
// ═══════════════════════════════════════════════════════════

export interface Conversion {
  assetIn: Address
  assetOut: Address
  oracle: Address
  swapTolerance: bigint
}

export interface AaveCondition {
  lenderId: number
  pool: Address
  minHealthFactor: bigint
}

export interface MorphoCondition {
  lenderId: number
  morpho: Address
  marketId: Hex
  minHealthFactor: bigint
}

export type Condition = AaveCondition | MorphoCondition

function isMorphoCondition(c: Condition): c is MorphoCondition {
  return 'marketId' in c
}

/**
 * Encode settlementData for oracle-verified swaps.
 *
 * Format:
 *   [1: numConversions]
 *   [per conversion (68 bytes)]: [20: assetIn][20: assetOut][20: oracle][8: swapTolerance]
 *   [optional 1: numConditions]
 *   [per condition]: variable by lenderId
 */
export function encodeSettlementData(
  conversions: Conversion[],
  conditions?: Condition[],
): Hex {
  const parts: Hex[] = [
    encodePacked(['uint8'], [conversions.length]),
  ]

  for (const c of conversions) {
    parts.push(
      encodePacked(
        ['address', 'address', 'address', 'uint64'],
        [c.assetIn, c.assetOut, c.oracle, c.swapTolerance],
      ),
    )
  }

  if (conditions && conditions.length > 0) {
    parts.push(encodePacked(['uint8'], [conditions.length]))
    for (const cond of conditions) {
      if (isMorphoCondition(cond)) {
        parts.push(
          encodePacked(
            ['uint16', 'address', 'bytes32', 'uint112'],
            [cond.lenderId, cond.morpho, cond.marketId, cond.minHealthFactor],
          ),
        )
      } else {
        parts.push(
          encodePacked(
            ['uint16', 'address', 'uint112'],
            [cond.lenderId, cond.pool, cond.minHealthFactor],
          ),
        )
      }
    }
  }

  return concatHex(parts)
}

/**
 * Encode settlementData for a simple migration (APR check).
 *
 * Format: [1: intentType=1][20: sourcePool][20: destPool][20: borrowAsset]
 */
export function encodeMigrationSettlementData(
  sourcePool: Address,
  destPool: Address,
  borrowAsset: Address,
): Hex {
  return encodePacked(
    ['uint8', 'address', 'address', 'address'],
    [1, sourcePool, destPool, borrowAsset],
  )
}

// ═══════════════════════════════════════════════════════════
//  Order Data (signed by user)
// ═══════════════════════════════════════════════════════════

/**
 * Encode orderData: [32: merkleRoot][2: settlementDataLength][settlementData]
 */
export function encodeOrderData(merkleRoot: Hex, settlementData: Hex = '0x'): Hex {
  const sdBytes = settlementData === '0x' ? '0x' as Hex : settlementData
  const sdLen = sdBytes === '0x' ? 0 : (sdBytes.length - 2) / 2
  return concatHex([
    merkleRoot,
    encodePacked(['uint16'], [sdLen]),
    ...(sdLen > 0 ? [sdBytes] : []),
  ])
}

// ═══════════════════════════════════════════════════════════
//  Execution Data (solver-provided)
// ═══════════════════════════════════════════════════════════

export interface ActionCalldata {
  asset: Address
  amount: bigint
  receiver: Address
  op: number
  lender: number
  data: Hex
  proof: Hex[]
}

/**
 * Encode a single action for executionData.
 *
 * Format:
 *   [20: asset][14: amount][20: receiver]
 *   [1: op][2: lender][2: dataLen][data]
 *   [1: proofLen][proofLen × 32: proof siblings]
 */
function encodeAction(action: ActionCalldata): Hex {
  const dataLen = (action.data.length - 2) / 2

  const parts: Hex[] = [
    encodePacked(
      ['address', 'uint112', 'address'],
      [action.asset, action.amount, action.receiver],
    ),
    encodePacked(
      ['uint8', 'uint16', 'uint16'],
      [action.op, action.lender, dataLen],
    ),
    action.data,
    encodePacked(['uint8'], [action.proof.length]),
  ]

  for (const sibling of action.proof) {
    parts.push(sibling as Hex)
  }

  return concatHex(parts)
}

/**
 * Encode executionData.
 *
 * Format:
 *   [1: numPre][1: numPost][20: feeRecipient]
 *   [actions...]
 */
export function encodeExecutionData(
  preActions: ActionCalldata[],
  postActions: ActionCalldata[],
  feeRecipient: Address = '0x0000000000000000000000000000000000000000',
): Hex {
  const header = encodePacked(
    ['uint8', 'uint8', 'address'],
    [preActions.length, postActions.length, feeRecipient],
  )

  const actionParts = [...preActions, ...postActions].map(encodeAction)

  return concatHex([header, ...actionParts])
}

// ═══════════════════════════════════════════════════════════
//  Filler Calldata (solver-provided swap execution)
// ═══════════════════════════════════════════════════════════

export interface SwapParams {
  assetIn: Address
  assetOut: Address
  /** Set to 0n for balance-based swap (recommended after max withdrawals) */
  amountIn: bigint
  target: Address
  calldata: Hex
}

/**
 * Encode fillerCalldata for one or more swaps.
 *
 * Per swap format:
 *   [20: assetIn][20: assetOut][14: amountIn]
 *   [20: target][2: calldataLen][calldataLen: calldata]
 */
export function encodeFillerCalldata(swaps: SwapParams[]): Hex {
  if (swaps.length === 0) return '0x'

  const parts: Hex[] = []
  for (const s of swaps) {
    const cdLen = (s.calldata.length - 2) / 2
    parts.push(
      encodePacked(
        ['address', 'address', 'uint112', 'address', 'uint16'],
        [s.assetIn, s.assetOut, s.amountIn, s.target, cdLen],
      ),
    )
    parts.push(s.calldata)
  }

  return concatHex(parts)
}
