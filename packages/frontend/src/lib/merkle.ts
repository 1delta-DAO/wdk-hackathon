import { keccak256, encodePacked, concatHex, type Hex, type Address } from 'viem'

// ── Lender ID ranges (must match DeltaEnums.sol) ────────────

export const LENDER_ID_AAVE_V3 = 0
export const LENDER_ID_AAVE_V2 = 1000
export const LENDER_ID_COMPOUND_V3 = 2000
export const LENDER_ID_MORPHO = 4000

// ── Ops (must match DeltaEnums.sol LenderOps) ───────────────

export const LenderOps = {
  DEPOSIT: 0,
  BORROW: 1,
  REPAY: 2,
  WITHDRAW: 3,
} as const

// ── Leaf construction ───────────────────────────────────────

export interface LeafParams {
  op: number
  lender: number
  data: Hex
}

export function buildLeaf(params: LeafParams): Hex {
  return keccak256(
    encodePacked(
      ['uint8', 'uint16', 'bytes'],
      [params.op, params.lender, params.data],
    ),
  )
}

// ── Aave lender data builders ───────────────────────────────

export const AaveData = {
  /** DEPOSIT data: [20: pool] */
  deposit(pool: Address): Hex {
    return encodePacked(['address'], [pool])
  },

  /** BORROW data: [1: mode][20: pool] — mode 2 = variable rate */
  borrow(pool: Address, mode: number = 2): Hex {
    return encodePacked(['uint8', 'address'], [mode, pool])
  },

  /** REPAY data: [1: mode][20: debtToken][20: pool] */
  repay(debtToken: Address, pool: Address, mode: number = 2): Hex {
    return encodePacked(['uint8', 'address', 'address'], [mode, debtToken, pool])
  },

  /** WITHDRAW data: [20: aToken][20: pool] */
  withdraw(aToken: Address, pool: Address): Hex {
    return encodePacked(['address', 'address'], [aToken, pool])
  },
}

// ── Sorted-pair hash (matches on-chain verification) ────────

function pairHash(a: Hex, b: Hex): Hex {
  const [lo, hi] = BigInt(a) < BigInt(b) ? [a, b] : [b, a]
  return keccak256(encodePacked(['bytes32', 'bytes32'], [lo, hi]))
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

// ── Merkle tree construction ────────────────────────────────

export function buildMerkleTree(leaves: Hex[]): {
  root: Hex
  proofs: Hex[][]
} {
  if (leaves.length === 0) throw new Error('Empty leaves')
  if (leaves.length === 1) return { root: leaves[0], proofs: [[]] }

  const size = nextPow2(leaves.length)
  const padded = [...leaves]
  const zeroHash = ('0x' + '00'.repeat(32)) as Hex
  while (padded.length < size) padded.push(zeroHash)

  const layers: Hex[][] = [padded]
  let current = padded
  while (current.length > 1) {
    const next: Hex[] = []
    for (let i = 0; i < current.length; i += 2) {
      next.push(pairHash(current[i], current[i + 1]))
    }
    layers.push(next)
    current = next
  }

  const root = layers[layers.length - 1][0]

  const proofs: Hex[][] = []
  for (let leafIdx = 0; leafIdx < leaves.length; leafIdx++) {
    const proof: Hex[] = []
    let idx = leafIdx
    for (let layer = 0; layer < layers.length - 1; layer++) {
      const siblingIdx = idx ^ 1
      proof.push(layers[layer][siblingIdx])
      idx = idx >> 1
    }
    proofs.push(proof)
  }

  return { root, proofs }
}

// ── High-level: build all Aave leaves for selected tokens ───

export interface AaveLeafInput {
  protocolId: string
  underlying: Address
  aToken: Address | undefined
  vToken: Address | undefined
  pool: Address
  /** 0 for V3 forks, 1000 for V2 forks */
  lenderId: number
}

export interface GeneratedLeaf {
  leaf: Hex
  op: number
  opName: string
  lender: number
  protocolId: string
  underlying: Address
  tokenAddress: Address
  tokenType: 'aToken' | 'vToken' | 'pool'
  data: Hex
}

/**
 * For a single underlying asset, generate all 4 operation leaves:
 * - DEPOSIT (uses pool)
 * - BORROW (uses pool)
 * - REPAY (uses vToken + pool)
 * - WITHDRAW (uses aToken + pool)
 */
export function buildAaveLeavesForToken(input: AaveLeafInput): GeneratedLeaf[] {
  const { protocolId, underlying, aToken, vToken, pool, lenderId } = input
  const leaves: GeneratedLeaf[] = []

  // DEPOSIT — always available (just needs pool)
  const depositData = AaveData.deposit(pool)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.DEPOSIT, lender: lenderId, data: depositData }),
    op: LenderOps.DEPOSIT,
    opName: 'Deposit',
    lender: lenderId,
    protocolId,
    underlying,
    tokenAddress: pool,
    tokenType: 'pool',
    data: depositData,
  })

  // BORROW — always available (just needs pool)
  const borrowData = AaveData.borrow(pool)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.BORROW, lender: lenderId, data: borrowData }),
    op: LenderOps.BORROW,
    opName: 'Borrow',
    lender: lenderId,
    protocolId,
    underlying,
    tokenAddress: pool,
    tokenType: 'pool',
    data: borrowData,
  })

  // REPAY — needs vToken
  if (vToken) {
    const repayData = AaveData.repay(vToken, pool)
    leaves.push({
      leaf: buildLeaf({ op: LenderOps.REPAY, lender: lenderId, data: repayData }),
      op: LenderOps.REPAY,
      opName: 'Repay',
      lender: lenderId,
      protocolId,
      underlying,
      tokenAddress: vToken,
      tokenType: 'vToken',
      data: repayData,
    })
  }

  // WITHDRAW — needs aToken
  if (aToken) {
    const withdrawData = AaveData.withdraw(aToken, pool)
    leaves.push({
      leaf: buildLeaf({ op: LenderOps.WITHDRAW, lender: lenderId, data: withdrawData }),
      op: LenderOps.WITHDRAW,
      opName: 'Withdraw',
      lender: lenderId,
      protocolId,
      underlying,
      tokenAddress: aToken,
      tokenType: 'aToken',
      data: withdrawData,
    })
  }

  return leaves
}

export const CompoundV3Data = {
  /** DEPOSIT data: [20: comet] */
  deposit(comet: Address): Hex {
    return encodePacked(['address'], [comet])
  },

  /** BORROW data: [20: comet] */
  borrow(comet: Address): Hex {
    return encodePacked(['address'], [comet])
  },

  /** REPAY data: [20: comet] */
  repay(comet: Address): Hex {
    return encodePacked(['address'], [comet])
  },

  /** WITHDRAW data: [1: isBase][20: comet] — isBase 0 = collateral, 1 = base asset */
  withdraw(comet: Address, isBase: number = 0): Hex {
    return encodePacked(['uint8', 'address'], [isBase, comet])
  },
}

export interface CompoundV3LeafInput {
  protocolId: string
  comet: Address
  lenderId: number
}


export function buildCompoundV3LeavesForComet(input: CompoundV3LeafInput): GeneratedLeaf[] {
  const { protocolId, comet, lenderId } = input
  const leaves: GeneratedLeaf[] = []

  const repayData = CompoundV3Data.repay(comet)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.REPAY, lender: lenderId, data: repayData }),
    op: LenderOps.REPAY,
    opName: 'Repay',
    lender: lenderId,
    protocolId,
    underlying: comet,
    tokenAddress: comet,
    tokenType: 'pool',
    data: repayData,
  })

  const withdrawData = CompoundV3Data.withdraw(comet, 0)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.WITHDRAW, lender: lenderId, data: withdrawData }),
    op: LenderOps.WITHDRAW,
    opName: 'Withdraw',
    lender: lenderId,
    protocolId,
    underlying: comet,
    tokenAddress: comet,
    tokenType: 'pool',
    data: withdrawData,
  })

  const depositData = CompoundV3Data.deposit(comet)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.DEPOSIT, lender: lenderId, data: depositData }),
    op: LenderOps.DEPOSIT,
    opName: 'Deposit',
    lender: lenderId,
    protocolId,
    underlying: comet,
    tokenAddress: comet,
    tokenType: 'pool',
    data: depositData,
  })

  const borrowData = CompoundV3Data.borrow(comet)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.BORROW, lender: lenderId, data: borrowData }),
    op: LenderOps.BORROW,
    opName: 'Borrow',
    lender: lenderId,
    protocolId,
    underlying: comet,
    tokenAddress: comet,
    tokenType: 'pool',
    data: borrowData,
  })

  return leaves
}

// ── Morpho lender data builders ─────────────────────────────

export interface MorphoMarketParams {
  loanToken: Address
  collateralToken: Address
  oracle: Address
  irm: Address
  lltv: bigint
}

export const MorphoData = {
  /** BORROW / WITHDRAW data: [20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho] */
  borrowOrWithdraw(market: MorphoMarketParams, morpho: Address, flags: number = 0): Hex {
    return encodePacked(
      ['address', 'address', 'address', 'address', 'uint128', 'uint8', 'address'],
      [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv, flags, morpho],
    )
  },

  /** DEPOSIT / REPAY data: [20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho][2: cbLen][cbData] */
  depositOrRepay(market: MorphoMarketParams, morpho: Address, flags: number = 0, callbackData: Hex = '0x'): Hex {
    const cbLen = callbackData === '0x' ? 0 : (callbackData.length - 2) / 2
    const base = encodePacked(
      ['address', 'address', 'address', 'address', 'uint128', 'uint8', 'address', 'uint16'],
      [market.loanToken, market.collateralToken, market.oracle, market.irm, market.lltv, flags, morpho, cbLen],
    )
    if (cbLen === 0) return base
    return concatHex([base, callbackData])
  },
}

export interface MorphoLeafInput {
  protocolId: string
  market: MorphoMarketParams
  morpho: Address
  lenderId: number
}

/** Generate all 4 operation leaves for a Morpho market */
export function buildMorphoLeavesForMarket(input: MorphoLeafInput): GeneratedLeaf[] {
  const { protocolId, market, morpho, lenderId } = input
  const leaves: GeneratedLeaf[] = []

  // DEPOSIT
  const depositData = MorphoData.depositOrRepay(market, morpho)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.DEPOSIT, lender: lenderId, data: depositData }),
    op: LenderOps.DEPOSIT,
    opName: 'Deposit',
    lender: lenderId,
    protocolId,
    underlying: market.loanToken,
    tokenAddress: morpho,
    tokenType: 'pool',
    data: depositData,
  })

  // BORROW
  const borrowData = MorphoData.borrowOrWithdraw(market, morpho)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.BORROW, lender: lenderId, data: borrowData }),
    op: LenderOps.BORROW,
    opName: 'Borrow',
    lender: lenderId,
    protocolId,
    underlying: market.loanToken,
    tokenAddress: morpho,
    tokenType: 'pool',
    data: borrowData,
  })

  // REPAY
  const repayData = MorphoData.depositOrRepay(market, morpho)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.REPAY, lender: lenderId, data: repayData }),
    op: LenderOps.REPAY,
    opName: 'Repay',
    lender: lenderId,
    protocolId,
    underlying: market.loanToken,
    tokenAddress: morpho,
    tokenType: 'pool',
    data: repayData,
  })

  // WITHDRAW
  const withdrawData = MorphoData.borrowOrWithdraw(market, morpho)
  leaves.push({
    leaf: buildLeaf({ op: LenderOps.WITHDRAW, lender: lenderId, data: withdrawData }),
    op: LenderOps.WITHDRAW,
    opName: 'Withdraw',
    lender: lenderId,
    protocolId,
    underlying: market.loanToken,
    tokenAddress: morpho,
    tokenType: 'pool',
    data: withdrawData,
  })

  return leaves
}

/** Map protocol ID to lender ID range */
export function protocolToLenderId(protocolId: string): number {
  if (protocolId === 'AAVE_V2') return LENDER_ID_AAVE_V2
  if (protocolId.startsWith('COMPOUND_V3_')) return LENDER_ID_COMPOUND_V3
  if (protocolId.startsWith('MORPHO_BLUE') || protocolId === 'MORPHO_BLUE' || protocolId === 'LISTA_DAO') return LENDER_ID_MORPHO
  return LENDER_ID_AAVE_V3
}
