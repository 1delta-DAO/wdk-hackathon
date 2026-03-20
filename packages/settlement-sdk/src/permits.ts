import { encodeFunctionData, type Hex } from 'viem'
import type { Address } from './constants.js'

// ═══════════════════════════════════════════════════════════
//  Typed data definitions for off-chain signing
// ═══════════════════════════════════════════════════════════

/** ERC-2612 permit typed data for walletClient.signTypedData() */
export const PermitTypedData = {
  types: {
    Permit: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Permit' as const,
}

/** Morpho Blue authorization typed data */
export const MorphoAuthorizationTypedData = {
  types: {
    Authorization: [
      { name: 'authorizer', type: 'address' },
      { name: 'authorized', type: 'address' },
      { name: 'isAuthorized', type: 'bool' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'Authorization' as const,
}

/** Compound V3 allowBySig typed data */
export const CompoundV3AuthorizationTypedData = {
  types: {
    Authorization: [
      { name: 'owner', type: 'address' },
      { name: 'manager', type: 'address' },
      { name: 'isAllowed', type: 'bool' },
      { name: 'nonce', type: 'uint256' },
      { name: 'expiry', type: 'uint256' },
    ],
  },
  primaryType: 'Authorization' as const,
}

/** Aave V3 credit delegation typed data */
export const AaveDelegationTypedData = {
  types: {
    DelegationWithSig: [
      { name: 'delegatee', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  },
  primaryType: 'DelegationWithSig' as const,
}

/** Settlement order typed data */
export const SettlementOrderTypedData = {
  types: {
    InfiniteOrder: [
      { name: 'merkleRoot', type: 'bytes32' },
      { name: 'deadline', type: 'uint48' },
      { name: 'maxFeeBps', type: 'uint256' },
      { name: 'solver', type: 'address' },
      { name: 'settlementData', type: 'bytes' },
    ],
  },
  primaryType: 'InfiniteOrder' as const,
}

// ═══════════════════════════════════════════════════════════
//  Message builders (for signTypedData)
// ═══════════════════════════════════════════════════════════

export interface PermitMessage {
  owner: Address
  spender: Address
  value: bigint
  nonce: bigint
  deadline: bigint
}

export function buildPermitMessage(params: {
  owner: Address
  spender: Address
  value?: bigint
  nonce: bigint
  deadline: bigint
}): PermitMessage {
  return {
    owner: params.owner,
    spender: params.spender,
    value: params.value ?? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    nonce: params.nonce,
    deadline: params.deadline,
  }
}

export interface MorphoAuthMessage {
  authorizer: Address
  authorized: Address
  isAuthorized: boolean
  nonce: bigint
  deadline: bigint
}

export function buildMorphoAuthMessage(params: {
  authorizer: Address
  authorized: Address
  isAuthorized?: boolean
  nonce: bigint
  deadline: bigint
}): MorphoAuthMessage {
  return {
    authorizer: params.authorizer,
    authorized: params.authorized,
    isAuthorized: params.isAuthorized ?? true,
    nonce: params.nonce,
    deadline: params.deadline,
  }
}

export interface CompoundV3AuthMessage {
  owner: Address
  manager: Address
  isAllowed: boolean
  nonce: bigint
  expiry: bigint
}

export function buildCompoundV3AuthMessage(params: {
  owner: Address
  manager: Address
  isAllowed?: boolean
  nonce: bigint
  expiry: bigint
}): CompoundV3AuthMessage {
  return {
    owner: params.owner,
    manager: params.manager,
    isAllowed: params.isAllowed ?? true,
    nonce: params.nonce,
    expiry: params.expiry,
  }
}

export interface AaveDelegationMessage {
  delegatee: Address
  value: bigint
  nonce: bigint
  deadline: bigint
}

export function buildAaveDelegationMessage(params: {
  delegatee: Address
  value?: bigint
  nonce: bigint
  deadline: bigint
}): AaveDelegationMessage {
  return {
    delegatee: params.delegatee,
    value: params.value ?? BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'),
    nonce: params.nonce,
    deadline: params.deadline,
  }
}

export interface SettlementOrderMessage {
  merkleRoot: Hex
  deadline: number
  maxFeeBps: bigint
  solver: Address
  settlementData: Hex
}

export function buildSettlementOrderMessage(params: {
  merkleRoot: Hex
  deadline: number
  maxFeeBps?: number | bigint
  solver?: Address
  settlementData?: Hex
}): SettlementOrderMessage {
  return {
    merkleRoot: params.merkleRoot,
    deadline: params.deadline,
    maxFeeBps: BigInt(params.maxFeeBps ?? 0),
    solver: params.solver ?? '0x0000000000000000000000000000000000000000',
    settlementData: params.settlementData ?? '0x',
  }
}

// ═══════════════════════════════════════════════════════════
//  Domain builders
// ═══════════════════════════════════════════════════════════

export interface TypedDataDomain {
  name?: string
  version?: string
  chainId: number
  verifyingContract: Address
}

export function permitDomain(params: {
  tokenName: string
  version?: string
  chainId: number
  tokenAddress: Address
}): TypedDataDomain {
  return {
    name: params.tokenName,
    version: params.version ?? '1',
    chainId: params.chainId,
    verifyingContract: params.tokenAddress,
  }
}

export function morphoDomain(params: {
  chainId: number
  morpho: Address
}): TypedDataDomain {
  return {
    chainId: params.chainId,
    verifyingContract: params.morpho,
  }
}

export function compoundV3Domain(params: {
  name: string
  version: string
  chainId: number
  comet: Address
}): TypedDataDomain {
  return {
    name: params.name,
    version: params.version,
    chainId: params.chainId,
    verifyingContract: params.comet,
  }
}

export function aaveDelegationDomain(params: {
  debtTokenName: string
  chainId: number
  debtToken: Address
}): TypedDataDomain {
  return {
    name: params.debtTokenName,
    version: '1',
    chainId: params.chainId,
    verifyingContract: params.debtToken,
  }
}

export function settlementDomain(params: {
  name?: string
  chainId: number
  settlement: Address
}): TypedDataDomain {
  return {
    name: params.name ?? 'InfiniteSettlement',
    version: '1',
    chainId: params.chainId,
    verifyingContract: params.settlement,
  }
}

// ═══════════════════════════════════════════════════════════
//  Multicall calldata encoding
// ═══════════════════════════════════════════════════════════

/** Signature components as returned by viem's parseSignature */
export interface SplitSignature {
  v: number
  r: Hex
  s: Hex
}

/** ABI fragments for the settlement contract's signature forwarding functions */
const settlementPermitAbi = [{
  name: 'permit',
  type: 'function',
  inputs: [
    { name: 'token', type: 'address' },
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const

const settlementMorphoAuthAbi = [{
  name: 'morphoSetAuthorizationWithSig',
  type: 'function',
  inputs: [
    { name: 'morpho', type: 'address' },
    { name: 'authorizer', type: 'address' },
    { name: 'authorized', type: 'address' },
    { name: 'isAuthorized', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const

const settlementCompoundV3AuthAbi = [{
  name: 'compoundV3AllowBySig',
  type: 'function',
  inputs: [
    { name: 'comet', type: 'address' },
    { name: 'owner', type: 'address' },
    { name: 'manager', type: 'address' },
    { name: 'isAllowed', type: 'bool' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const

const settlementAaveDelegationAbi = [{
  name: 'aaveDelegationWithSig',
  type: 'function',
  inputs: [
    { name: 'debtToken', type: 'address' },
    { name: 'delegator', type: 'address' },
    { name: 'delegatee', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'v', type: 'uint8' },
    { name: 'r', type: 'bytes32' },
    { name: 's', type: 'bytes32' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const

/**
 * Encode a permit call for the settlement multicall.
 */
export function encodePermitCall(params: {
  token: Address
  owner: Address
  spender: Address
  value: bigint
  deadline: bigint
  sig: SplitSignature
}): Hex {
  return encodeFunctionData({
    abi: settlementPermitAbi,
    functionName: 'permit',
    args: [params.token, params.owner, params.spender, params.value, params.deadline, params.sig.v, params.sig.r, params.sig.s],
  })
}

/**
 * Encode a Morpho setAuthorizationWithSig call for the settlement multicall.
 */
export function encodeMorphoAuthCall(params: {
  morpho: Address
  authorizer: Address
  authorized: Address
  isAuthorized?: boolean
  nonce: bigint
  deadline: bigint
  sig: SplitSignature
}): Hex {
  return encodeFunctionData({
    abi: settlementMorphoAuthAbi,
    functionName: 'morphoSetAuthorizationWithSig',
    args: [params.morpho, params.authorizer, params.authorized, params.isAuthorized ?? true, params.nonce, params.deadline, params.sig.v, params.sig.r, params.sig.s],
  })
}

/**
 * Encode a Compound V3 allowBySig call for the settlement multicall.
 */
export function encodeCompoundV3AuthCall(params: {
  comet: Address
  owner: Address
  manager: Address
  isAllowed?: boolean
  nonce: bigint
  expiry: bigint
  sig: SplitSignature
}): Hex {
  return encodeFunctionData({
    abi: settlementCompoundV3AuthAbi,
    functionName: 'compoundV3AllowBySig',
    args: [params.comet, params.owner, params.manager, params.isAllowed ?? true, params.nonce, params.expiry, params.sig.v, params.sig.r, params.sig.s],
  })
}

/**
 * Encode an Aave V3 delegationWithSig call for the settlement multicall.
 */
export function encodeAaveDelegationCall(params: {
  debtToken: Address
  delegator: Address
  delegatee: Address
  value: bigint
  deadline: bigint
  sig: SplitSignature
}): Hex {
  return encodeFunctionData({
    abi: settlementAaveDelegationAbi,
    functionName: 'aaveDelegationWithSig',
    args: [params.debtToken, params.delegator, params.delegatee, params.value, params.deadline, params.sig.v, params.sig.r, params.sig.s],
  })
}

/** ABI fragment for multicall */
export const multicallAbi = [{
  name: 'multicall',
  type: 'function',
  inputs: [{ name: 'data', type: 'bytes[]' }],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const

/** ABI fragment for settleWithFlashLoan */
export const settleWithFlashLoanAbi = [{
  name: 'settleWithFlashLoan',
  type: 'function',
  inputs: [
    { name: 'flashLoanAsset', type: 'address' },
    { name: 'flashLoanAmount', type: 'uint256' },
    { name: 'flashLoanPool', type: 'address' },
    { name: 'poolId', type: 'uint8' },
    { name: 'maxFeeBps', type: 'uint256' },
    { name: 'solver', type: 'address' },
    { name: 'deadline', type: 'uint48' },
    { name: 'signature', type: 'bytes' },
    { name: 'orderData', type: 'bytes' },
    { name: 'executionData', type: 'bytes' },
    { name: 'fillerCalldata', type: 'bytes' },
  ],
  outputs: [],
  stateMutability: 'nonpayable',
}] as const
