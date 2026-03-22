# Why we stub `sodium-native` for Cloudflare Workers

## The problem

`@tetherto/wdk-wallet-evm` depends on `sodium-universal`, which at module
initialisation unconditionally does:

```js
module.exports = require('sodium-native')
```

`sodium-native` is a native C++ addon (it ships pre-compiled `.node` binaries).
Cloudflare Workers run inside V8 isolates — native addons cannot be loaded there.
Wrangler's esbuild bundler fails at build time with:

```
✘ [ERROR] Could not resolve "sodium-native"
```

## What `sodium_memzero` actually does

`sodium_memzero(buffer)` is a **memory hygiene** primitive from libsodium. Its
sole purpose is to wipe a buffer containing sensitive material (e.g. a private
key) from RAM after it is no longer needed.

The native implementation has two properties a plain `memset` lacks:

1. **Compiler barrier** — it is implemented in a way that prevents optimising
   compilers from eliding the write (a compiler is allowed to remove a
   `memset` it can prove has no observable effect).
2. **OS-level guarantee** — on some platforms it calls `SecureZeroMemory`
   (Windows) or `explicit_bzero` (glibc) which the kernel will honour even
   under memory pressure.

In `wdk-wallet-evm` it is called in `MemorySafeSigningKey.dispose()` to zero
the private-key `Buffer` after a transaction is signed. All actual cryptographic
operations (ECDSA signing, HMAC-SHA256 for key derivation) use the pure-JS
`@noble/secp256k1` and `@noble/hashes` libraries — `sodium-native` is not
involved in any cryptographic computation.

## Why the stub is not a security risk in Workers

The threat model `sodium_memzero` addresses is:

| Threat | Requires |
|---|---|
| Memory / core dump | Persistent OS process, raw `/proc` access |
| Swap file leak | OS-managed swap partition |
| Cold-boot attack | Physical RAM persistence after power loss |
| Cross-tenant memory read | Shared address space |

None of these apply to Cloudflare Workers:

- Each Worker runs in an **isolated V8 isolate**; no other tenant can inspect
  its memory.
- The isolate is **torn down after each invocation**; there is no long-lived
  process for an attacker to dump.
- Workers have **no filesystem or swap partition**.
- The private key already lives in V8's **GC-managed heap**, which
  `sodium_memzero` cannot fully protect anyway — V8 may copy the buffer
  internally before the dispose call.

The Workers isolation boundary provides stronger containment guarantees than
`sodium_memzero` was designed to give.

## The fix

`wrangler.toml` uses Wrangler's `[alias]` feature to redirect `sodium-native`
to a local stub at build time:

```toml
[alias]
"sodium-native" = "./src/sodium-native-stub.cjs"
```

The stub (`src/sodium-native-stub.cjs`) exports `sodium_memzero` as a
best-effort JS buffer fill:

```js
module.exports = {
  sodium_memzero (buf) {
    if (buf && buf.fill) buf.fill(0)
  },
}
```

This satisfies the import, keeps the buffer-zeroing behaviour, and lets the
Workers bundle compile cleanly. No cryptographic functionality is affected.
