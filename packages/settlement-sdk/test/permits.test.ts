import { describe, it, expect } from 'vitest'
import { decodeFunctionData, parseAbi } from 'viem'
import {
  // Typed data
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
  // Calldata encoders
  encodePermitCall,
  encodeMorphoAuthCall,
  encodeCompoundV3AuthCall,
  encodeAaveDelegationCall,
} from '../src/permits.js'

const USER = '0x000000000000000000000000000000000000cafe' as const
const SETTLEMENT = '0x000000000000000000000000000000000000beef' as const
const TOKEN = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as const
const MORPHO = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb' as const
const COMET = '0xc3d688B66703497DAA19211EEdff47f25384cdc3' as const
const DEBT_TOKEN = '0xeA51d7853EEFb32b6ee06b1C12E6dcCA88Be0fFE' as const

const DUMMY_SIG = {
  v: 27,
  r: '0x' + 'aa'.repeat(32) as `0x${string}`,
  s: '0x' + 'bb'.repeat(32) as `0x${string}`,
}

// ── Typed data definitions ──────────────────────────────

describe('typed data definitions', () => {
  it('PermitTypedData has correct structure', () => {
    expect(PermitTypedData.primaryType).toBe('Permit')
    expect(PermitTypedData.types.Permit).toHaveLength(5)
  })

  it('MorphoAuthorizationTypedData has correct structure', () => {
    expect(MorphoAuthorizationTypedData.primaryType).toBe('Authorization')
    expect(MorphoAuthorizationTypedData.types.Authorization).toHaveLength(5)
  })

  it('CompoundV3AuthorizationTypedData has correct structure', () => {
    expect(CompoundV3AuthorizationTypedData.primaryType).toBe('Authorization')
    expect(CompoundV3AuthorizationTypedData.types.Authorization).toHaveLength(5)
  })

  it('AaveDelegationTypedData has correct structure', () => {
    expect(AaveDelegationTypedData.primaryType).toBe('DelegationWithSig')
    expect(AaveDelegationTypedData.types.DelegationWithSig).toHaveLength(4)
  })

  it('SettlementOrderTypedData has correct structure', () => {
    expect(SettlementOrderTypedData.primaryType).toBe('MigrationOrder')
    expect(SettlementOrderTypedData.types.MigrationOrder).toHaveLength(3)
  })
})

// ── Message builders ────────────────────────────────────

describe('message builders', () => {
  it('buildPermitMessage defaults value to max uint256', () => {
    const msg = buildPermitMessage({
      owner: USER,
      spender: SETTLEMENT,
      nonce: 0n,
      deadline: 1000n,
    })
    expect(msg.value).toBe(BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'))
    expect(msg.owner).toBe(USER)
    expect(msg.spender).toBe(SETTLEMENT)
  })

  it('buildPermitMessage accepts custom value', () => {
    const msg = buildPermitMessage({
      owner: USER,
      spender: SETTLEMENT,
      value: 1000n,
      nonce: 0n,
      deadline: 1000n,
    })
    expect(msg.value).toBe(1000n)
  })

  it('buildMorphoAuthMessage defaults isAuthorized to true', () => {
    const msg = buildMorphoAuthMessage({
      authorizer: USER,
      authorized: SETTLEMENT,
      nonce: 0n,
      deadline: 1000n,
    })
    expect(msg.isAuthorized).toBe(true)
  })

  it('buildCompoundV3AuthMessage builds correct shape', () => {
    const msg = buildCompoundV3AuthMessage({
      owner: USER,
      manager: SETTLEMENT,
      nonce: 5n,
      expiry: 2000n,
    })
    expect(msg.owner).toBe(USER)
    expect(msg.manager).toBe(SETTLEMENT)
    expect(msg.isAllowed).toBe(true)
    expect(msg.nonce).toBe(5n)
    expect(msg.expiry).toBe(2000n)
  })

  it('buildAaveDelegationMessage defaults value to max', () => {
    const msg = buildAaveDelegationMessage({
      delegatee: SETTLEMENT,
      nonce: 0n,
      deadline: 1000n,
    })
    expect(msg.delegatee).toBe(SETTLEMENT)
    expect(msg.value).toBe(BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'))
  })

  it('buildSettlementOrderMessage defaults settlementData to 0x', () => {
    const msg = buildSettlementOrderMessage({
      merkleRoot: '0x' + 'ab'.repeat(32) as `0x${string}`,
      deadline: 1000,
    })
    expect(msg.settlementData).toBe('0x')
  })
})

// ── Domain builders ─────────────────────────────────────

describe('domain builders', () => {
  it('permitDomain has all fields', () => {
    const d = permitDomain({ tokenName: 'WETH', chainId: 1, tokenAddress: TOKEN })
    expect(d.name).toBe('WETH')
    expect(d.version).toBe('1')
    expect(d.chainId).toBe(1)
    expect(d.verifyingContract).toBe(TOKEN)
  })

  it('morphoDomain omits name/version', () => {
    const d = morphoDomain({ chainId: 1, morpho: MORPHO })
    expect(d.name).toBeUndefined()
    expect(d.version).toBeUndefined()
    expect(d.verifyingContract).toBe(MORPHO)
  })

  it('compoundV3Domain includes name and version', () => {
    const d = compoundV3Domain({ name: 'Compound USDC', version: '0', chainId: 1, comet: COMET })
    expect(d.name).toBe('Compound USDC')
    expect(d.version).toBe('0')
  })

  it('aaveDelegationDomain uses version 1', () => {
    const d = aaveDelegationDomain({ debtTokenName: 'Aave Variable Debt WETH', chainId: 1, debtToken: DEBT_TOKEN })
    expect(d.version).toBe('1')
  })

  it('settlementDomain defaults name to MigrationSettlement', () => {
    const d = settlementDomain({ chainId: 1, settlement: SETTLEMENT })
    expect(d.name).toBe('MigrationSettlement')
  })

  it('settlementDomain accepts custom name', () => {
    const d = settlementDomain({ name: 'Settlement', chainId: 1, settlement: SETTLEMENT })
    expect(d.name).toBe('Settlement')
  })
})

// ── Calldata encoders ───────────────────────────────────

const permitAbi = parseAbi([
  'function permit(address token, address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
])
const morphoAuthAbi = parseAbi([
  'function morphoSetAuthorizationWithSig(address morpho, address authorizer, address authorized, bool isAuthorized, uint256 nonce, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
])
const compoundAuthAbi = parseAbi([
  'function compoundV3AllowBySig(address comet, address owner, address manager, bool isAllowed, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s)',
])
const aaveDelegationAbi = parseAbi([
  'function aaveDelegationWithSig(address debtToken, address delegator, address delegatee, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
])

describe('encodePermitCall', () => {
  it('encodes valid permit calldata', () => {
    const cd = encodePermitCall({
      token: TOKEN,
      owner: USER,
      spender: SETTLEMENT,
      value: 1000n,
      deadline: 9999n,
      sig: DUMMY_SIG,
    })

    const decoded = decodeFunctionData({ abi: permitAbi, data: cd })
    expect(decoded.functionName).toBe('permit')
    expect(decoded.args[0].toLowerCase()).toBe(TOKEN.toLowerCase())
    expect(decoded.args[1].toLowerCase()).toBe(USER.toLowerCase())
    expect(decoded.args[2].toLowerCase()).toBe(SETTLEMENT.toLowerCase())
    expect(decoded.args[3]).toBe(1000n)
    expect(decoded.args[4]).toBe(9999n)
    expect(decoded.args[5]).toBe(27)
  })
})

describe('encodeMorphoAuthCall', () => {
  it('encodes valid morpho auth calldata', () => {
    const cd = encodeMorphoAuthCall({
      morpho: MORPHO,
      authorizer: USER,
      authorized: SETTLEMENT,
      nonce: 0n,
      deadline: 9999n,
      sig: DUMMY_SIG,
    })

    const decoded = decodeFunctionData({ abi: morphoAuthAbi, data: cd })
    expect(decoded.functionName).toBe('morphoSetAuthorizationWithSig')
    expect(decoded.args[0].toLowerCase()).toBe(MORPHO.toLowerCase())
    expect(decoded.args[1].toLowerCase()).toBe(USER.toLowerCase())
    expect(decoded.args[3]).toBe(true) // isAuthorized defaults to true
  })
})

describe('encodeCompoundV3AuthCall', () => {
  it('encodes valid compound v3 auth calldata', () => {
    const cd = encodeCompoundV3AuthCall({
      comet: COMET,
      owner: USER,
      manager: SETTLEMENT,
      nonce: 3n,
      expiry: 9999n,
      sig: DUMMY_SIG,
    })

    const decoded = decodeFunctionData({ abi: compoundAuthAbi, data: cd })
    expect(decoded.functionName).toBe('compoundV3AllowBySig')
    expect(decoded.args[3]).toBe(true) // isAllowed
    expect(decoded.args[4]).toBe(3n)   // nonce
  })
})

describe('encodeAaveDelegationCall', () => {
  it('encodes valid aave delegation calldata', () => {
    const maxUint = BigInt('0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')
    const cd = encodeAaveDelegationCall({
      debtToken: DEBT_TOKEN,
      delegator: USER,
      delegatee: SETTLEMENT,
      value: maxUint,
      deadline: 9999n,
      sig: DUMMY_SIG,
    })

    const decoded = decodeFunctionData({ abi: aaveDelegationAbi, data: cd })
    expect(decoded.functionName).toBe('aaveDelegationWithSig')
    expect(decoded.args[0].toLowerCase()).toBe(DEBT_TOKEN.toLowerCase())
    expect(decoded.args[3]).toBe(maxUint)
  })
})
