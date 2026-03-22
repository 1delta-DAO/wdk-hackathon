/**
 * Settlement transaction builder and submitter.
 *
 * Takes an already-decided source/dest leaf selection and builds the
 * settleWithFlashLoan calldata from the stored leaf proofs, then submits
 * via WDK sendTransaction.
 */

import { encodeFunctionData, createPublicClient, http, parseAbi, maxUint256 } from 'viem'
import type { Hex, Address } from 'viem'
import {
  encodeExecutionData,
  AmountSentinel,
  LenderOps,
  settleWithFlashLoanAbi,
  buildMerkleTree,
} from '@1delta/settlement-sdk'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { MerkleLeaf, SignedPermit, StoredOrder } from './order.js'
import { callTool } from './mcp.js'
import { DRY_RUN, ECONOMIC_MODE, RPC_URL_BY_CHAIN, CONTRACTS_BY_CHAIN } from './config.js'

// Morpho Blue flash loan pool — chain-specific, looked up from CONTRACTS_BY_CHAIN

// WETH on Arbitrum — used to price ETH gas costs via the Aave oracle
const WETH_ARB = '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1' as Address

const AAVE_ORACLE_ABI = parseAbi([
  'function getAssetPrice(address asset) external view returns (uint256)',
])

const ERC20_ABI = parseAbi([
  'function decimals() external view returns (uint8)',
])

// Settlement contract ABIs for permit/approval/multicall functions
const MULTICALL_ABI = parseAbi([
  'function multicall(bytes[] calldata data) external',
])

const APPROVE_TOKEN_ABI = parseAbi([
  'function approveToken(address token, address spender, uint256 amount) external',
])

const PERMIT_ABI = parseAbi([
  'function permit(address token, address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
])

const AAVE_DELEGATION_ABI = parseAbi([
  'function aaveDelegationWithSig(address debtToken, address delegator, address delegatee, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
])

const MORPHO_AUTH_ABI = parseAbi([
  'function morphoSetAuthorizationWithSig(address morpho, address authorizer, address authorized, bool isAuthorized, uint256 nonce, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external',
])

const COMPOUND_V3_ALLOW_ABI = parseAbi([
  'function compoundV3AllowBySig(address comet, address owner, address manager, bool isAllowed, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s) external',
])

// On-chain auth-check ABIs
const MORPHO_IS_AUTHORIZED_ABI = parseAbi([
  'function isAuthorized(address authorizer, address authorized) external view returns (bool)',
])

const COMET_IS_ALLOWED_ABI = parseAbi([
  'function isAllowed(address owner, address manager) external view returns (bool)',
])

const AAVE_BORROW_ALLOWANCE_ABI = parseAbi([
  'function borrowAllowance(address fromUser, address toUser) external view returns (uint256)',
])

/**
 * Encodes a signed permit into settlement contract calldata.
 * Each permit kind maps to a different contract function.
 */
function encodePermitCall(
  permit: SignedPermit,
  signer: Address,
  settlement: Address,
): Hex {
  switch (permit.kind) {
    case 'ERC2612_PERMIT':
      return encodeFunctionData({
        abi: PERMIT_ABI,
        functionName: 'permit',
        args: [
          permit.targetAddress,
          signer,
          settlement,
          maxUint256,
          BigInt(permit.deadline),
          permit.v,
          permit.r as `0x${string}`,
          permit.s as `0x${string}`,
        ],
      })

    case 'AAVE_DELEGATION':
      return encodeFunctionData({
        abi: AAVE_DELEGATION_ABI,
        functionName: 'aaveDelegationWithSig',
        args: [
          permit.targetAddress,
          signer,
          settlement,
          maxUint256,
          BigInt(permit.deadline),
          permit.v,
          permit.r as `0x${string}`,
          permit.s as `0x${string}`,
        ],
      })

    case 'MORPHO_AUTHORIZATION':
      return encodeFunctionData({
        abi: MORPHO_AUTH_ABI,
        functionName: 'morphoSetAuthorizationWithSig',
        args: [
          permit.targetAddress,
          signer,
          settlement,
          true,
          BigInt(permit.nonce),
          BigInt(permit.deadline),
          permit.v,
          permit.r as `0x${string}`,
          permit.s as `0x${string}`,
        ],
      })

    case 'COMPOUND_V3_ALLOW':
      return encodeFunctionData({
        abi: COMPOUND_V3_ALLOW_ABI,
        functionName: 'compoundV3AllowBySig',
        args: [
          permit.targetAddress,
          signer,
          settlement,
          true,
          BigInt(permit.nonce),
          BigInt(permit.deadline),
          permit.v,
          permit.r as `0x${string}`,
          permit.s as `0x${string}`,
        ],
      })
  }
}

export interface EconomicCheckResult {
  viable: boolean
  reason: string
  solverFeeUsdE8: bigint
  gasCostUsdE8: bigint
}

/**
 * Checks whether executing the settlement is economically worthwhile:
 * solverFee (USD) must exceed estimated gas cost (USD).
 *
 * Prices are sourced from the Aave oracle (8-decimal USD values).
 * If any price/gas call fails the check is skipped and execution proceeds.
 */
export async function checkEconomicViability(
  input: SettlementInput,
  txData: { to: Address; data: Hex },
  flashAmount: bigint,
  aaveOracleAddress: Address,
  fromAddress: Address,
  rpcUrl: string,
): Promise<EconomicCheckResult> {
  const client = createPublicClient({ transport: http(rpcUrl) })

  // Solver fee in debt token base units
  const solverFeeBaseUnits = (flashAmount * BigInt(input.order.order.maxFeeBps)) / 10_000_000n

  // Validate tx first — a revert here means the migration itself is invalid, not an oracle issue.
  // Let this throw — the caller distinguishes tx reverts from oracle errors.
  const gasEstimate = await client.estimateGas({ account: fromAddress, to: txData.to, data: txData.data })

  // Fetch prices separately — failures here are oracle/infra issues, not tx failures
  let gasPrice: bigint, ethPrice: bigint, debtPrice: bigint, debtDecimals: number
  try {
    ;[gasPrice, ethPrice, debtPrice, debtDecimals] = await Promise.all([
      client.getGasPrice(),
      client.readContract({ address: aaveOracleAddress, abi: AAVE_ORACLE_ABI, functionName: 'getAssetPrice', args: [WETH_ARB] }),
      client.readContract({ address: aaveOracleAddress, abi: AAVE_ORACLE_ABI, functionName: 'getAssetPrice', args: [input.debtAsset] }),
      client.readContract({ address: input.debtAsset, abi: ERC20_ABI, functionName: 'decimals' }),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Oracle/infra failure after tx validated — skip economic check, assume viable
    console.warn(`  Oracle/price check failed (${msg.slice(0, 100)}) — skipping economic check, proceeding`)
    return { viable: true, reason: 'oracle unavailable — skipped economic check', solverFeeUsdE8: 0n, gasCostUsdE8: 0n }
  }

  // Gas cost in USD (8 decimal precision): gasCostWei * ethPrice / 1e18
  const gasCostUsdE8 = (gasEstimate * gasPrice * ethPrice) / BigInt(1e18)

  // Solver fee in USD (8 decimal precision): feeBaseUnits * debtPrice / 10^debtDecimals
  const solverFeeUsdE8 = (solverFeeBaseUnits * debtPrice) / (10n ** BigInt(debtDecimals))

  const viable = solverFeeUsdE8 >= gasCostUsdE8

  const fmtUsd = (v: bigint) => `$${(Number(v) / 1e8).toFixed(6)}`
  const reason = viable
    ? `solverFee ${fmtUsd(solverFeeUsdE8)} >= gasCost ${fmtUsd(gasCostUsdE8)} — proceeding`
    : `solverFee ${fmtUsd(solverFeeUsdE8)} < gasCost ${fmtUsd(gasCostUsdE8)} — skipping (not economic)`

  return { viable, reason, solverFeeUsdE8, gasCostUsdE8 }
}

export interface SettlementInput {
  order: StoredOrder
  sourceRepayLeaf: MerkleLeaf
  sourceWithdrawLeaf: MerkleLeaf
  destDepositLeaf: MerkleLeaf
  destBorrowLeaf: MerkleLeaf
  /** Underlying collateral token (e.g. WETH) */
  collateralAsset: Address
  /** Underlying debt token (e.g. USDC) */
  debtAsset: Address
  /** User address — receives aTokens / debt on the dest protocol */
  user: Address
  /** Settlement contract address */
  settlement: Address
  /** Morpho Blue pool address (chain-specific flash loan provider) */
  morphoPool: Address
  /** Current debt in base units (from get_user_positions) */
  debtAmount: bigint
  /** Optional fee recipient for the solver */
  feeRecipient?: Address
}

/**
 * Filters permits to only include those not already satisfied on-chain.
 * Morpho authorization, Compound V3 allow, and Aave delegation are all
 * persistent — once granted they remain until revoked, so re-sending a
 * stale sig will revert with a nonce error.
 */
async function filterPermits(
  permits: SignedPermit[],
  user: Address,
  settlement: Address,
  rpcUrl: string,
): Promise<SignedPermit[]> {
  const client = createPublicClient({ transport: http(rpcUrl) })
  const result: SignedPermit[] = []

  for (const permit of permits) {
    try {
      if (permit.kind === 'MORPHO_AUTHORIZATION') {
        const authorized = await client.readContract({
          address: permit.targetAddress as Address,
          abi: MORPHO_IS_AUTHORIZED_ABI,
          functionName: 'isAuthorized',
          args: [user, settlement],
        })
        if (authorized) {
          console.log(`  Skipping MORPHO_AUTHORIZATION — already authorized (morpho=${permit.targetAddress})`)
          continue
        }
      } else if (permit.kind === 'COMPOUND_V3_ALLOW') {
        const allowed = await client.readContract({
          address: permit.targetAddress as Address,
          abi: COMET_IS_ALLOWED_ABI,
          functionName: 'isAllowed',
          args: [user, settlement],
        })
        if (allowed) {
          console.log(`  Skipping COMPOUND_V3_ALLOW — already allowed (comet=${permit.targetAddress})`)
          continue
        }
      } else if (permit.kind === 'AAVE_DELEGATION') {
        const allowance = await client.readContract({
          address: permit.targetAddress as Address,
          abi: AAVE_BORROW_ALLOWANCE_ABI,
          functionName: 'borrowAllowance',
          args: [user, settlement],
        })
        if (allowance > 0n) {
          console.log(`  Skipping AAVE_DELEGATION — already delegated (vToken=${permit.targetAddress}, allowance=${allowance})`)
          continue
        }
      }
    } catch (err) {
      // Can't determine auth state — include the permit to be safe
      console.warn(`  Could not check auth state for ${permit.kind} (${permit.targetAddress}): ${err instanceof Error ? err.message : err} — including permit`)
    }
    result.push(permit)
  }

  return result
}

/**
 * Builds the settleWithFlashLoan calldata from the chosen leaves.
 * Does NOT submit — returns the tx object for WDK sendTransaction.
 * If rpcUrl is provided, on-chain auth state is checked and already-satisfied
 * permits (Morpho, Compound V3, Aave delegation) are omitted from the multicall.
 */
export async function buildSettlementTx(input: SettlementInput, rpcUrl?: string): Promise<{
  to: Address
  data: Hex
  chainId: number
  flashAmount: bigint
  borrowAmount: bigint
}> {
  // Compute Merkle proofs from the full leaf set (API does not return proofs)
  const leafHashes = input.order.order.leaves.map(l => l.leaf as Hex)
  const { proofs } = buildMerkleTree(leafHashes)
  const proofFor = (leaf: MerkleLeaf): Hex[] => {
    const idx = input.order.order.leaves.indexOf(leaf)
    return idx >= 0 ? (proofs[idx] ?? []) : []
  }

  // Only add buffer when maxFeeBps > 0; when zero fee is allowed, any surplus reverts
  const buffer = input.order.order.maxFeeBps > 0 ? input.debtAmount / 10_000n + 1n : 0n
  const flashAmount = input.debtAmount + buffer

  // Solver fee is taken from the borrowed amount, not the flash loan
  const fee = (input.debtAmount * BigInt(input.order.order.maxFeeBps)) / 10_000_000n
  const borrowAmount = input.debtAmount + fee

  const executionData = encodeExecutionData(
    [
      // Pre 1: repay existing debt on source protocol
      {
        asset: input.debtAsset as Hex,
        amount: AmountSentinel.MAX,
        receiver: input.user as Hex,
        op: LenderOps.REPAY,
        lender: input.sourceRepayLeaf.lender,
        data: input.sourceRepayLeaf.data,
        proof: proofFor(input.sourceRepayLeaf),
      },
      // Pre 2: withdraw collateral from source protocol → settlement contract
      {
        asset: input.collateralAsset as Hex,
        amount: AmountSentinel.MAX,
        receiver: input.settlement as Hex,
        op: LenderOps.WITHDRAW,
        lender: input.sourceWithdrawLeaf.lender,
        data: input.sourceWithdrawLeaf.data,
        proof: proofFor(input.sourceWithdrawLeaf),
      },
    ],
    [
      // Post 1: deposit collateral on dest protocol for user
      {
        asset: input.collateralAsset as Hex,
        amount: AmountSentinel.BALANCE,
        receiver: input.user as Hex,
        op: LenderOps.DEPOSIT,
        lender: input.destDepositLeaf.lender,
        data: input.destDepositLeaf.data,
        proof: proofFor(input.destDepositLeaf),
      },
      // Post 2: borrow on dest protocol → settlement contract (repays flash loan)
      {
        asset: input.debtAsset as Hex,
        amount: borrowAmount,
        receiver: input.settlement as Hex,
        op: LenderOps.BORROW,
        lender: input.destBorrowLeaf.lender,
        data: input.destBorrowLeaf.data,
        proof: proofFor(input.destBorrowLeaf),
      },
    ],
    input.feeRecipient as Hex | undefined,
  )

  const settlementCall = encodeFunctionData({
    abi: settleWithFlashLoanAbi,
    functionName: 'settleWithFlashLoan',
    args: [
      input.debtAsset,
      flashAmount,
      input.morphoPool,
      0,                                       // poolId 0 = Morpho Blue
      BigInt(input.order.order.maxFeeBps),
      (input.order.order as any).solver ?? '0x0000000000000000000000000000000000000000',
      input.order.order.deadline,
      input.order.signature,
      input.order.order.orderData,             // signed by user, used as-is
      executionData,                           // rebuilt for chosen leaves
      '0x',                                    // no filler calldata (same-asset migration)
    ],
  })

  // Build multicall if there are permits or approvals to bundle
  // Skip permits that are already satisfied on-chain (persistent auth doesn't need re-signing)
  const rawPermits = input.order.order.permits ?? []
  const permits = rpcUrl
    ? await filterPermits(rawPermits, input.user, input.settlement, rpcUrl)
    : rawPermits

  const permitCalls = permits.map(p =>
    encodePermitCall(p, input.user, input.settlement),
  )

  // Extract spenders from leaf data:
  //   Compound V3 repay/deposit: data = [20: comet]
  //   Aave repay: data = [1: mode][20: vToken][20: pool] → pool at offset 21
  //   Aave deposit: data = [20: pool]
  //   Morpho: data = [20: loan][20: coll][20: oracle][20: irm][16: lltv][1: flags][20: morpho]
  //     → morpho pool at byte offset 97
  const spenderFromLeaf = (leaf: MerkleLeaf): Address => {
    const isMorpho = leaf.lender >= 4000 && leaf.lender < 5000
    if (isMorpho) {
      return `0x${leaf.data.slice(2 + 97 * 2, 2 + 117 * 2)}` as Address
    }
    const isAave = leaf.lender < 2000
    const isRepay = leaf.op === 2
    const offset = isAave && isRepay ? 21 : 0
    return `0x${leaf.data.slice(2 + offset * 2, 2 + (offset + 20) * 2)}` as Address
  }

  const repaySpender   = spenderFromLeaf(input.sourceRepayLeaf)
  const depositSpender = spenderFromLeaf(input.destDepositLeaf)
  const approve = (token: Address, spender: Address, amount: bigint) =>
    encodeFunctionData({ abi: APPROVE_TOKEN_ABI, functionName: 'approveToken', args: [token, spender, amount] })

  const tokenApprovals: Hex[] = [
    approve(input.debtAsset,       repaySpender,      maxUint256),
    approve(input.collateralAsset, depositSpender,    maxUint256),
    // maxUint256 here avoids the case where repaySpender === morphoPool (same Morpho Blue contract):
    // a flashAmount approval would overwrite the maxUint256 above, leaving insufficient allowance
    // after the repay step consumes most of it before the flash loan repayment runs.
    approve(input.debtAsset,       input.morphoPool,  maxUint256),
  ]

  const allCalls = [...permitCalls, ...tokenApprovals, settlementCall]

  // If there are extra calls to bundle, wrap in multicall; otherwise send bare
  let data: Hex
  if (allCalls.length > 1) {
    data = encodeFunctionData({
      abi: MULTICALL_ABI,
      functionName: 'multicall',
      args: [allCalls],
    })
  } else {
    data = settlementCall
  }

  return { to: input.settlement, data, chainId: input.order.order.chainId, flashAmount, borrowAmount }
}

/**
 * Builds and submits the settlement transaction via WDK sendTransaction.
 * Returns the transaction hash, or 'SKIPPED_NOT_ECONOMIC' if ECONOMIC_MODE
 * is enabled and the estimated gas cost exceeds the solver fee.
 */
export async function executeSettlement(
  wdkClient: Client,
  input: SettlementInput,
): Promise<string> {
  const rpcUrl = RPC_URL_BY_CHAIN[input.order.order.chainId]
  if (!rpcUrl) throw new Error(`No RPC URL for chainId ${input.order.order.chainId}`)

  const tx = await buildSettlementTx(input, rpcUrl)

  console.log('\n=== Settlement Tx ===')
  console.log(`  chainId:       ${tx.chainId}`)
  console.log(`  to:            ${tx.to}`)
  console.log(`  flashAmount:   ${tx.flashAmount}`)
  console.log(`  borrowAmount:  ${tx.borrowAmount}`)
  console.log(`  debtAsset:     ${input.debtAsset}`)
  console.log(`  collateral:    ${input.collateralAsset}`)
  console.log(`  source lender: ${input.sourceRepayLeaf.lender}`)
  console.log(`  dest lender:   ${input.destDepositLeaf.lender}`)
  console.log(`  calldata:      ${tx.data}`)
  console.log(`  from (solver): ${input.feeRecipient ?? input.user}`)

  if (ECONOMIC_MODE) {
    const chainContracts = CONTRACTS_BY_CHAIN[input.order.order.chainId]
    const fromAddress = input.feeRecipient ?? input.user
    console.log('\n[Economic check] Estimating gas vs solver fee…')
    try {
      const check = await checkEconomicViability(
        input,
        { to: tx.to, data: tx.data },
        tx.flashAmount,
        chainContracts.aaveOracle,
        fromAddress,
        rpcUrl
      )
      console.log(`  ${check.reason}`)
      if (!check.viable) {
        return 'SKIPPED_NOT_ECONOMIC'
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // estimateGas throws before oracle calls — so any error here is a tx-level revert
      console.warn(`  Gas estimation reverted (${msg.slice(0, 120)}) — tx would fail on-chain, skipping`)
      return 'SKIPPED_INVALID_TX'
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Not submitting. Calldata:')
    console.log(tx.data.slice(0, 200) + '…')
    return 'DRY_RUN'
  }

  const seed = process.env.WDK_SEED
  if (!seed) throw new Error('WDK_SEED env var is required for transaction signing')

  // Dynamic import keeps the CommonJS WDK wallet out of the Cloudflare Workers bundle path
  const WalletManagerEvm = (await import('@tetherto/wdk-wallet-evm')).default
  const wallet = new WalletManagerEvm(seed, { provider: rpcUrl })
  const account = await wallet.getAccount(0)

  const { hash } = await account.sendTransaction({ to: tx.to, data: tx.data, value: 0n })
  console.log('  tx hash:', hash)
  return hash
}
