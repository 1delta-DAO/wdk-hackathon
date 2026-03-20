import type { Address } from 'viem'

/** Deployed settlement contract addresses per chain */
export const SETTLEMENT_ADDRESSES: Record<number, Address> = {
  42161: '0x2FA48F02923a0C93326A68aA26E3a0b836d5685F', // Arbitrum
}

/** Deployed oracle adapter addresses per chain */
export const ORACLE_ADDRESSES: Record<number, Address> = {
  42161: '0x2E837679425d8B32cCDc4448ddC222930Ef6ED96', // Arbitrum
}

/** Order backend URL */
export const ORDER_BACKEND_URL = import.meta.env.VITE_ORDER_BACKEND_URL as string
  || 'http://localhost:8787'

/** Portal proxy URL (proxies https://portal.1delta.io with API key auth) */
export const PORTAL_PROXY_URL = import.meta.env.VITE_PORTAL_PROXY_URL as string
  || 'http://localhost:8788'
