import type { Address } from 'viem'

/** Deployed settlement contract addresses per chain */
export const SETTLEMENT_ADDRESSES: Record<number, Address> = {
  42161: '0x62002C215BF3c7a1FD1f794a8e664CF5dc4F3Da2', // Arbitrum
}

/** Deployed oracle adapter addresses per chain */
export const ORACLE_ADDRESSES: Record<number, Address> = {
  42161: '0x4b20b77aaCe3F0BD3Be3957CD15837FfEA2a1925', // Arbitrum
}

/** Order backend URL */
export const ORDER_BACKEND_URL = import.meta.env.VITE_ORDER_BACKEND_URL as string
  || 'http://localhost:8787'

/** Portal proxy URL (proxies https://portal.1delta.io with API key auth) */
export const PORTAL_PROXY_URL = import.meta.env.VITE_PORTAL_PROXY_URL as string
  || 'http://localhost:8788'
