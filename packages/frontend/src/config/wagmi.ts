import { http, createConfig } from 'wagmi'
import { mainnet, optimism, polygon, arbitrum, base, linea, scroll, mantle, bsc } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

const projectId = import.meta.env.VITE_WC_PROJECT_ID ?? ''

export const config = createConfig({
  chains: [mainnet, optimism, polygon, arbitrum, base, linea, scroll, mantle, bsc],
  connectors: [
    injected(),
    ...(projectId ? [walletConnect({ projectId })] : []),
  ],
  transports: {
    [mainnet.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [linea.id]: http(),
    [scroll.id]: http(),
    [mantle.id]: http(),
    [bsc.id]: http(),
  },
})
