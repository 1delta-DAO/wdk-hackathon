// Stub for sodium-native in Cloudflare Workers.
// The only function used by wdk-wallet-evm is sodium_memzero — a memory-safety
// helper that zeros private key buffers after use. In the Workers runtime the
// execution context is already isolated, so a best-effort fill is sufficient.
'use strict'

module.exports = {
  sodium_memzero (buf) {
    if (buf && buf.fill) buf.fill(0)
  },
}
