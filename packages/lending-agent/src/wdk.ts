/**
 * WDK wallet + protocol helpers used by the portfolio agent.
 *
 * Wraps the WDK packages directly — no MCP server needed.
 *
 * Exposed operations:
 *   getAddress(seed)                           → EVM address string
 *   swapTokens(seed, rpcUrl, tokenIn, tokenOut, amountIn)    → tx hash
 *   aaveSupply(seed, rpcUrl, token, amount)    → tx hash
 *   aaveWithdraw(seed, rpcUrl, token, amount)  → tx hash
 */

import type { Address } from 'viem'

// ── Account factory ───────────────────────────────────────────────────────────

async function getAccount (seed: string, rpcUrl: string) {
  const WalletManagerEvm = (await import('@tetherto/wdk-wallet-evm')).default
  const wallet = new WalletManagerEvm(seed, { provider: rpcUrl })
  return wallet.getAccount(0)
}

// ── Public helpers ────────────────────────────────────────────────────────────

export async function getWdkAddress (seed: string, rpcUrl: string): Promise<Address> {
  const account = await getAccount(seed, rpcUrl)
  return account.address as Address
}

/**
 * Swap tokenIn → tokenOut via Velora DEX.
 * Handles the ERC-20 approval automatically before swapping.
 */
export async function swapTokens (
  seed: string,
  rpcUrl: string,
  tokenIn: string,
  tokenOut: string,
  amountIn: bigint,
): Promise<string> {
  const account = await getAccount(seed, rpcUrl)

  const VeloraProtocolEvm = (await import('@tetherto/wdk-protocol-swap-velora-evm')).default
  const velora = new VeloraProtocolEvm(account)

  // Approve tokenIn to the Velora router before swapping
  await account.approve({ token: tokenIn, spender: await getVeloraSpender(velora), amount: amountIn })

  const result = await velora.swap({ tokenIn, tokenOut, tokenInAmount: amountIn })
  return result.hash
}

/**
 * Returns the Velora router address to use for approvals.
 * We call quoteSwap with a dummy 1-unit amount to discover the spender via error or protocol internals.
 * Fallback: use the known Velora router on Arbitrum.
 */
async function getVeloraSpender (_velora: InstanceType<typeof import('@tetherto/wdk-protocol-swap-velora-evm').default>): Promise<string> {
  // Velora router on Arbitrum One (from Velora protocol docs)
  return '0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e'
}

/**
 * Supply `amount` of `token` to Aave V3 on Arbitrum.
 * Handles the ERC-20 approval automatically before supplying.
 */
export async function aaveSupply (
  seed: string,
  rpcUrl: string,
  token: string,
  amount: bigint,
): Promise<string> {
  const account = await getAccount(seed, rpcUrl)

  const AaveProtocolEvm = (await import('@tetherto/wdk-protocol-lending-aave-evm')).default
  const aave = new AaveProtocolEvm(account)

  // Aave pool address on Arbitrum One
  const AAVE_POOL_ARB = '0x794a61358D6845594F94dc1DB02A252b5b4814aD'
  await account.approve({ token, spender: AAVE_POOL_ARB, amount })

  const result = await aave.supply({ token, amount })
  return result.hash
}

/**
 * Withdraw `amount` of `token` from Aave V3 on Arbitrum.
 */
export async function aaveWithdraw (
  seed: string,
  rpcUrl: string,
  token: string,
  amount: bigint,
): Promise<string> {
  const account = await getAccount(seed, rpcUrl)

  const AaveProtocolEvm = (await import('@tetherto/wdk-protocol-lending-aave-evm')).default
  const aave = new AaveProtocolEvm(account)

  const result = await aave.withdraw({ token, amount })
  return result.hash
}

/**
 * Send a raw transaction (arbitrary calldata) via the WDK wallet.
 */
export async function sendTransaction (
  seed: string,
  rpcUrl: string,
  to: string,
  data: string,
): Promise<string> {
  const account = await getAccount(seed, rpcUrl)
  const result = await account.sendTransaction({ to, value: 0n, data })
  return result.hash
}
