import { mainnet, optimism, polygon, arbitrum, base, linea, scroll, mantle, bsc } from 'wagmi/chains'
import type { Chain } from 'wagmi/chains'

export const SUPPORTED_CHAINS: Chain[] = [
  mainnet,
  optimism,
  polygon,
  arbitrum,
  base,
  linea,
  scroll,
  mantle,
  bsc,
]

export const CHAIN_ID_TO_CHAIN = Object.fromEntries(
  SUPPORTED_CHAINS.map((c) => [c.id, c])
) as Record<number, Chain>
