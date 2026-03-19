import type { Address, Hex } from 'viem'
import {
  encodeAaveHealthCondition,
  encodeMorphoHealthCondition,
} from './calldata.js'

/**
 * Curated "batch" → flat health-factor condition rows for `settlementData`.
 * On-chain still evaluates each row; this is UX/expansion only.
 */
export type AaveStableBatchMember = {
  kind: 'aave'
  lenderId: number
  pool: Address
}

export type MorphoStableBatchMember = {
  kind: 'morpho'
  lenderId: number
  morpho: Address
  marketId: Hex
}

export type StableHealthBatch = {
  id: string
  label: string
  minHealthFactor: bigint
  members: (AaveStableBatchMember | MorphoStableBatchMember)[]
}

export function expandStableBatchToConditions(batch: StableHealthBatch): Hex[] {
  const out: Hex[] = []
  for (const m of batch.members) {
    if (m.kind === 'aave') {
      out.push(
        encodeAaveHealthCondition({
          lenderId: m.lenderId,
          pool: m.pool,
          minHealthFactor: batch.minHealthFactor,
        }),
      )
    } else {
      out.push(
        encodeMorphoHealthCondition({
          lenderId: m.lenderId,
          morpho: m.morpho,
          marketId: m.marketId,
          minHealthFactor: batch.minHealthFactor,
        }),
      )
    }
  }
  return out
}

/**
 * Build a batch from API-shaped records (caller maps meta → members).
 * `Record<batchId, StableHealthBatch>` keeps lookup O(1).
 */
export function batchesById(batches: StableHealthBatch[]): Record<string, StableHealthBatch> {
  const map: Record<string, StableHealthBatch> = {}
  for (const b of batches) {
    map[b.id] = b
  }
  return map
}
