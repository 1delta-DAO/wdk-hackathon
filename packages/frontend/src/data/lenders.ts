import type { Address } from 'viem'
import { AAVE_TOKENS } from './aaveTokens'

// ── Protocol types ──────────────────────────────────────────

export type ProtocolFamily = 'AAVE' | 'COMPOUND_V3' | 'MORPHO_BLUE'

export interface LenderProtocol {
  family: ProtocolFamily
  id: string          // e.g. "AAVE_V3", "COMPOUND_V3_USDC", "MORPHO_BLUE"
  label: string       // human-readable
}

// ── Permission types needed per protocol ────────────────────

export type PermissionKind =
  | 'ERC2612_PERMIT'         // aToken approve
  | 'AAVE_DELEGATION'        // vToken credit delegation
  | 'AAVE_DELEGATION_TX'     // vToken credit delegation (on-chain approveDelegation call)
  | 'COMPOUND_V3_ALLOW'      // Comet manager allow
  | 'MORPHO_AUTHORIZATION'   // Morpho Blue setAuthorization

export interface PermissionDef {
  kind: PermissionKind
  label: string
  description: string
}

export const PERMISSION_DEFS: Record<PermissionKind, PermissionDef> = {
  ERC2612_PERMIT: {
    kind: 'ERC2612_PERMIT',
    label: 'Token Permit (ERC-2612)',
    description: 'Approve the settlement contract to transfer aTokens on your behalf',
  },
  AAVE_DELEGATION: {
    kind: 'AAVE_DELEGATION',
    label: 'Credit Delegation',
    description: 'Delegate borrowing power to the settlement contract via debt tokens',
  },
  COMPOUND_V3_ALLOW: {
    kind: 'COMPOUND_V3_ALLOW',
    label: 'Manager Authorization',
    description: 'Allow the settlement contract to manage your Compound V3 position',
  },
  MORPHO_AUTHORIZATION: {
    kind: 'MORPHO_AUTHORIZATION',
    label: 'Morpho Authorization',
    description: 'Authorize the settlement contract to act on your behalf in Morpho Blue',
  },
}

// ── Aave token permission: one signable entity per aToken/vToken ──

export interface AaveTokenPermission {
  underlying: Address
  tokenAddress: Address
  kind: PermissionKind // ERC2612_PERMIT for aToken, AAVE_DELEGATION for vToken
  tokenType: 'aToken' | 'vToken'
}

/** Get all signable aToken/vToken permissions for an Aave protocol on a chain */
export function getAaveTokenPermissions(protocolId: string, chainId: number): AaveTokenPermission[] {
  const tokens = AAVE_TOKENS[protocolId]?.[String(chainId)]
  if (!tokens) return []

  const perms: AaveTokenPermission[] = []
  for (const [underlying, entry] of Object.entries(tokens)) {
    if (entry.aToken) {
      perms.push({
        underlying: underlying as Address,
        tokenAddress: entry.aToken as Address,
        kind: 'ERC2612_PERMIT',
        tokenType: 'aToken',
      })
    }
    if (entry.vToken) {
      perms.push({
        underlying: underlying as Address,
        tokenAddress: entry.vToken as Address,
        kind: 'AAVE_DELEGATION',
        tokenType: 'vToken',
      })
    }
  }
  return perms
}

// ── Compound V3 pools (comet addresses) ─────────────────────

export const COMPOUND_V3_POOLS: Record<string, Record<string, Address>> = {
  "1": {
    "COMPOUND_V3_USDC": "0xc3d688B66703497DAA19211EEdff47f25384cdc3",
    "COMPOUND_V3_USDS": "0x5D409e56D886231aDAf00c8775665AD0f9897b56",
    "COMPOUND_V3_USDT": "0x3Afdc9BCA9213A35503b077a6072F3D0d5AB0840",
    "COMPOUND_V3_WBTC": "0xe85Dc543813B8c2CFEaAc371517b925a166a9293",
    "COMPOUND_V3_WETH": "0xA17581A9E3356d9A858b789D68B4d866e593aE94",
    "COMPOUND_V3_WSTETH": "0x3D0bb1ccaB520A66e607822fC55BC921738fAFE3",
  },
  "10": {
    "COMPOUND_V3_USDC": "0x2e44e174f7D53F0212823acC11C01A11d58c5bCB",
    "COMPOUND_V3_USDT": "0x995E394b8B2437aC8Ce61Ee0bC610D617962B214",
    "COMPOUND_V3_WETH": "0xE36A30D249f7761327fd973001A32010b521b6Fd",
  },
  "137": {
    "COMPOUND_V3_USDCE": "0xF25212E676D1F7F89Cd72fFEe66158f541246445",
    "COMPOUND_V3_USDT": "0xaeB318360f27748Acb200CE616E389A6C9409a07",
  },
  "8453": {
    "COMPOUND_V3_AERO": "0x784efeB622244d2348d4F2522f8860B96fbEcE89",
    "COMPOUND_V3_USDBC": "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
    "COMPOUND_V3_USDC": "0xb125E6687d4313864e53df431d5425969c15Eb2F",
    "COMPOUND_V3_WETH": "0x46e6b214b524310239732D51387075E0e70970bf",
  },
  "42161": {
    "COMPOUND_V3_USDC": "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf",
    "COMPOUND_V3_USDCE": "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA",
    "COMPOUND_V3_USDT": "0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07",
    "COMPOUND_V3_WETH": "0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486",
  },
  "59144": {
    "COMPOUND_V3_USDC": "0x8D38A3d6B3c3B7d96D6536DA7Eef94A9d7dbC991",
    "COMPOUND_V3_WETH": "0x60F2058379716A64a7A5d29219397e79bC552194",
  },
  "534352": {
    "COMPOUND_V3_USDC": "0xB2f97c1Bd3bf02f5e74d13f02E3e26F93D77CE44",
  },
  "5000": {
    "COMPOUND_V3_USDE": "0x606174f62cd968d8e684c645080fa694c1D7786E",
  },
}

// ── Aave pools ──────────────────────────────────────────────

export interface AavePoolConfig {
  pool: Address
  protocolDataProvider: Address
}

export const AAVE_POOLS: Record<string, Record<string, AavePoolConfig>> = {
  "AAVE_V2": {
    "1": { pool: "0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9", protocolDataProvider: "0x057835Ad21a177dbdd3090bB1CAE03EaCF78Fc6d" },
    "137": { pool: "0x8dff5e27ea6b7ac08ebfdf9eb090f32ee9a30fcf", protocolDataProvider: "0x7551b5D2763519d4e37e8B81929D336De671d46d" },
  },
  "AAVE_V3": {
    "1": { pool: "0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2", protocolDataProvider: "0x41393e5e337606dc3821075Af65AeE84D7688CBD" },
    "10": { pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", protocolDataProvider: "0x7F23D86Ee20D869112572136221e173428DD740B" },
    "56": { pool: "0x6807dc923806fE8Fd134338EABCA509979a7e0cB", protocolDataProvider: "0x23dF2a19384231aFD114b036C14b6b03324D79BC" },
    "137": { pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", protocolDataProvider: "0x7F23D86Ee20D869112572136221e173428DD740B" },
    "8453": { pool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5", protocolDataProvider: "0xd82a47fdebB5bf5329b09441C3DaB4b5df2153Ad" },
    "42161": { pool: "0x794a61358D6845594F94dc1DB02A252b5b4814aD", protocolDataProvider: "0x7F23D86Ee20D869112572136221e173428DD740B" },
    "59144": { pool: "0xc47b8C00b0f69a36fa203Ffeac0334874574a8Ac", protocolDataProvider: "0x9eEBf28397D8bECC999472fC8838CBbeF54aebf6" },
    "534352": { pool: "0x11fCfe756c05AD438e312a7fd934381537D3cFfe", protocolDataProvider: "0xe2108b60623C6Dcf7bBd535bD15a451fd0811f7b" },
    "5000": { pool: "0x458F293454fE0d67EC0655f3672301301DD51422", protocolDataProvider: "0x487c5c669D9eee6057C44973207101276cf73b68" },
  },
  "AAVE_V3_ETHER_FI": {
    "1": { pool: "0x0AA97c284e98396202b6A04024F5E2c65026F3c0", protocolDataProvider: "0xE7d490885A68f00d9886508DF281D67263ed5758" },
  },
  "AAVE_V3_HORIZON": {
    "1": { pool: "0xAe05Cd22df81871bc7cC2a04BeCfb516bFe332C8", protocolDataProvider: "0x53519c32f73fE1797d10210c4950fFeBa3b21504" },
  },
  "AAVE_V3_PRIME": {
    "1": { pool: "0x4e033931ad43597d96D6bcc25c280717730B58B1", protocolDataProvider: "0x08795CFE08C7a81dCDFf482BbAAF474B240f31cD" },
  },
  "SPARK": {
    "1": { pool: "0xC13e21B648A5Ee794902342038FF3aDAB66BE987", protocolDataProvider: "0xFc21d6d146E6086B8359705C8b28512a983db0cb" },
  },
  "ZEROLEND": {
    "59144": { pool: "0x2f9bB73a8e98793e26Cb2F6C4ad037BDf1C6B269", protocolDataProvider: "0x67f93d36792c49a4493652B91ad4bD59f428AD15" },
    "8453": { pool: "0x766f21277087E18967c1b10bF602d8Fe56d0c671", protocolDataProvider: "0xA754b2f1535287957933db6e2AEE2b2FE6f38588" },
  },
  "LENDLE": {
    "5000": { pool: "0xCFa5aE7c2CE8Fadc6426C1ff872cA45378Fb7cF3", protocolDataProvider: "0x552b9e4bae485C4B7F540777d7D25614CdB84773" },
  },
  "AURELIUS": {
    "5000": { pool: "0x7c9C6F5BEd9Cfe5B9070C7D3322CF39eAD2F9492", protocolDataProvider: "0xedB4f24e4b74a6B1e20e2EAf70806EAC19E1FA54" },
  },
  "RADIANT_V2": {
    "1": { pool: "0xA950974f64aA33f27F6C5e017eEE93BF7588ED07", protocolDataProvider: "0x362f3BB63Cff83bd169aE1793979E9e537993813" },
    "42161": { pool: "0xE23B4AE3624fB6f7cDEF29bC8EAD912f1Ede6886", protocolDataProvider: "0x790c039fcabed1a5a91517e11f03e26720c1b368" },
    "8453": { pool: "0x30798cFe2CCa822321ceed7e6085e633aAbC492F", protocolDataProvider: "0xd184c5315b728c1c990f59ddd275c8155f8e255c" },
    "56": { pool: "0xCcf31D54C3A94f67b8cEFF8DD771DE5846dA032c", protocolDataProvider: "0x6bc6acb905c1216b0119c87bf9e178ce298310fa" },
  },
  "GRANARY": {
    "1": { pool: "0xB702cE183b4E1Faa574834715E5D4a6378D0eEd3", protocolDataProvider: "0x33c62BC416309F010c4941163aBEa3725e4645BF" },
    "10": { pool: "0x8FD4aF47E4E63d1D2D45582c3286b4BD9Bb95DfE", protocolDataProvider: "0x9546F673eF71Ff666ae66d01Fd6E7C6Dae5a9995" },
    "56": { pool: "0x7171054f8d148Fe1097948923C91A6596fC29032", protocolDataProvider: "0x7Fb479624ca336bA8f2dc66439F8683330eE2880" },
    "8453": { pool: "0xB702cE183b4E1Faa574834715E5D4a6378D0eEd3", protocolDataProvider: "0xed984A0E9c12Ee27602314191Fc4487A702bB83f" },
    "42161": { pool: "0x102442A3BA1e441043154Bc0B8A2e2FB5E0F94A7", protocolDataProvider: "0x96bCFB86F1bFf315c13e00D850e2FAeA93CcD3e7" },
    "59144": { pool: "0x871AfF0013bE6218B61b28b274a6F53DB131795F", protocolDataProvider: "0xd2abC5d7841d49C40Fd35A1Ec832ee1daCC8D339" },
  },
  "KINZA": {
    "1": { pool: "0xeA14474946C59Dee1F103aD517132B3F19Cef1bE", protocolDataProvider: "0xE44990a8a732605Eddc0870597d2Cf4A2637F038" },
    "56": { pool: "0xcB0620b181140e57D1C0D8b724cde623cA963c8C", protocolDataProvider: "0x09Ddc4AE826601b0F9671b9edffDf75e7E6f5D61" },
    "5000": { pool: "0x5757b15f60331eF3eDb11b16ab0ae72aE678Ed51", protocolDataProvider: "0x18cc2c55b429EE08748951bBD33FF2a68c95ec38" },
  },
  "PLOUTOS": {
    "42161": { pool: "0xDdc98fF53945e334Ecca339b4DD8847b3769e8f0", protocolDataProvider: "0x0F65a7fBCb69074cF8BE8De1E01Ef573da34bD59" },
  },
  "AVALON": {
    "42161": { pool: "0xe1ee45DB12ac98d16F1342a03c93673d74527b55", protocolDataProvider: "0xEc579d2cE07401258710199Ff12a5bb56e086a6F" },
  },
  "AVALON_PUMPBTC": {
    "42161": { pool: "0x4B801fb6f0830D070f40aff9ADFC8f6939Cc1F8D", protocolDataProvider: "0x2c4aEB7C9f0D196a51136B3c7bec49cB2DBD1966" },
  },
  "YLDR": {
    "42161": { pool: "0x54aD657851b6Ae95bA3380704996CAAd4b7751A3", protocolDataProvider: "0x6b69CB817AFa481FF80cb954feAA3be0835b36f9" },
  },
}

// ── Morpho Blue addresses ───────────────────────────────────

export const MORPHO_BLUE_ADDRESSES: Record<string, Address> = {
  "1": "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  "10": "0xce95AfbB8EA029495c66020883F87aaE8864AF92",
  "56": "0x01b0Bd309AA75547f7a37Ad7B1219A898E67a83a",
  "137": "0x1bF0c2541F820E775182832f06c0B7Fc27A25f67",
  "8453": "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb",
  "42161": "0x6c247b1F6182318877311737BaC0844bAa518F5e",
  "534352": "0x2d012EdbAdc37eDc2BC62791B666f9193FDF5a55",
}

// ── Helpers ─────────────────────────────────────────────────

/** Human-readable label for a protocol ID */
function protocolLabel(id: string): string {
  // Map protocol IDs to friendly names - label as "Aave" family
  const labels: Record<string, string> = {
    AAVE_V2: 'Aave V2',
    AAVE_V3: 'Aave V3',
    AAVE_V3_ETHER_FI: 'Aave Ether.fi',
    AAVE_V3_HORIZON: 'Aave Horizon',
    AAVE_V3_PRIME: 'Aave Prime',
    SPARK: 'Spark',
    ZEROLEND: 'ZeroLend',
    LENDLE: 'Lendle',
    AURELIUS: 'Aurelius',
    RADIANT_V2: 'Radiant V2',
    GRANARY: 'Granary',
    KINZA: 'Kinza',
    PLOUTOS: 'Ploutos',
    AVALON: 'Avalon',
    AVALON_PUMPBTC: 'Avalon PumpBTC',
    YLDR: 'YLDR',
  }
  return labels[id] ?? id.replace(/_/g, ' ')
}

/** Get all available lender protocols for a given chain */
export function getLendersForChain(chainId: number): LenderProtocol[] {
  const cid = String(chainId)
  const lenders: LenderProtocol[] = []

  // Aave forks
  for (const forkName of Object.keys(AAVE_POOLS)) {
    if (AAVE_POOLS[forkName][cid]) {
      lenders.push({
        family: 'AAVE',
        id: forkName,
        label: protocolLabel(forkName),
      })
    }
  }

  // Compound V3 markets
  const compPools = COMPOUND_V3_POOLS[cid]
  if (compPools) {
    for (const marketId of Object.keys(compPools)) {
      const baseAsset = marketId.replace('COMPOUND_V3_', '')
      lenders.push({
        family: 'COMPOUND_V3',
        id: marketId,
        label: `Compound V3 ${baseAsset}`,
      })
    }
  }

  // Morpho Blue
  if (MORPHO_BLUE_ADDRESSES[cid]) {
    lenders.push({
      family: 'MORPHO_BLUE',
      id: 'MORPHO_BLUE',
      label: 'Morpho Blue',
    })
  }

  return lenders
}

/** Get the contract address for a specific lender */
export function getPermissionTarget(
  chainId: number,
  lender: LenderProtocol,
): Address | undefined {
  const cid = String(chainId)
  switch (lender.family) {
    case 'COMPOUND_V3':
      return COMPOUND_V3_POOLS[cid]?.[lender.id]
    case 'MORPHO_BLUE':
      return MORPHO_BLUE_ADDRESSES[cid]
    case 'AAVE':
      return AAVE_POOLS[lender.id]?.[cid]?.pool
    default:
      return undefined
  }
}
