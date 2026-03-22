# Free Ethereum Mainnet RPCs

Switch `ETH_RPC_URL` in `.env` when rate-limited. Sorted by reliability.

## Recommended (no key required)

| RPC | Notes |
|-----|-------|
| `https://ethereum-rpc.publicnode.com` | Fast, reliable |
| `https://0xrpc.io/eth` | Good uptime |
| `https://eth.meowrpc.com` | |
| `https://eth.drpc.org` | |
| `https://eth.merkle.io` | |
| `https://rpc.mevblocker.io` | MEV-protected |
| `https://gateway.tenderly.co/public/mainnet` | |
| `https://ethereum-public.nodies.app` | |
| `https://eth-mainnet.public.blastapi.io` | |
| `https://ethereum.public.blockpi.network/v1/rpc/public` | |
| `https://eth.api.onfinality.io/public` | |
| `https://rpc.eth.gateway.fm` | |
| `https://eth1.lava.build` | |
| `https://public-eth.nownodes.io` | |
| `https://eth.blockrazor.xyz` | |
| `https://ethereum.rpc.subquery.network/public` | |
| `https://api.zan.top/eth-mainnet` | |

## Known restrictive (avoid for fork tests)

| RPC | Issue |
|-----|-------|
| `https://1rpc.io/eth` | Quota exceeded quickly |
| `https://eth.llamarpc.com` | Too restrictive for fork tests |

## With API key

| RPC | Notes |
|-----|-------|
| `https://eth-mainnet.nodereal.io/v1/<key>` | Free tier available |
| `https://go.getblock.io/<key>` | Free tier available |
| `https://eth-mainnet.rpcfast.com?api_key=<key>` | |

## WebSocket (for event subscriptions)

| RPC |
|-----|
| `wss://ethereum-rpc.publicnode.com` |
| `wss://0xrpc.io/eth` |
| `wss://eth.drpc.org` |
| `wss://mainnet.gateway.tenderly.co` |

## Quick switch

```bash
# In .env:
ETH_RPC_URL=https://eth.llamarpc.com

# Or override per-command:
ETH_RPC_URL=https://ethereum-rpc.publicnode.com forge test
```
