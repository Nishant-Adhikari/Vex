# Tools — Protocol Clients, Wallet, & Service Integrations

> All protocol-specific SDK wrappers, API clients, and on-chain utilities. Each subfolder is a self-contained integration with its own types, validation, and client layer. Commands (`src/commands/`) delegate here for business logic; vex-agent tools (`src/vex-agent/tools/protocols/`) also consume these clients.
>
> **Last updated: 2026-03-31**
>
> **LLM maintainers:** If you add/remove a protocol or change a module's scope, update this file AND the subfolder's own .md doc.

---

## Module Map

| Folder | Protocol / Service | Chain | Files | Docs |
|--------|--------------------|-------|-------|------|
| `0g-compute/` | 0G Compute Network (inference, ledger, monitor) | 0G | 11 | [0G-COMPUTE.md](0g-compute/0G-COMPUTE.md) |
| `0g-storage/` | 0G Storage (file upload/download, virtual drive) | 0G | 5 | [0G-STORAGE.md](0g-storage/0G-STORAGE.md) |
| `chainscan/` | ChainScan block explorer API | 0G | 4 | [CHAINSCAN.md](chainscan/CHAINSCAN.md) |
| `dexscreener/` | DexScreener analytics (REST + WS) | Multi-chain | 5 | [DexScreener.md](dexscreener/DexScreener.md) |
| `echobook/` | EchoBook social trading platform | — | 14 | [ECHOBOOK.md](echobook/ECHOBOOK.md) |
| `jaine/` | Jaine DEX (Uniswap V3 fork, routing, subgraph) | 0G | 18 | [JAINE.md](jaine/JAINE.md) |
| `khalani/` | Khalani cross-chain bridge (40+ chains) | Multi-chain | 7 | [Khalani.md](khalani/Khalani.md) |
| `kyberswap/` | KyberSwap aggregator, limit orders, ZaaS | 18 EVM chains | 22 | [KyberSwap.md](kyberswap/KyberSwap.md) |
| `polymarket/` | Polymarket prediction markets (CLOB, Gamma, Relayer) | Polygon | 22 | [Polymarket.md](polymarket/Polymarket.md) |
| `slop/` | Slop.money bonding curves (math, auth, ABIs) | 0G | 8 | [SLOP.md](slop/SLOP.md) |
| `slop-app/` | Slop.money social APIs (profile, chat, image, agents) | — | 4 | [SLOP-APP.md](slop-app/SLOP-APP.md) |
| `solana-ecosystem/` | Jupiter (swap, prices, tokens, lend, predict) + shared Solana utils | Solana | 35 | [Jupiter.md](solana-ecosystem/jupiter/Jupiter.md) |
| `wallet/` | Multi-chain keystore, signing, native balances | EVM + Solana | 12 | [WALLET.md](wallet/WALLET.md) |

**Total: ~167 files across 13 modules**

---

## Architecture Pattern

Every protocol module follows the same layered pattern:

```
types.ts          — Domain types (response shapes, enums, configs)
validation.ts     — Runtime validators for external data (API responses)
errors.ts         — HTTP/protocol error → VexError mapping
client.ts         — API client (singleton, rate-limited, retry, timeout)
constants.ts      — URLs, limits, addresses, fee tiers
```

Some modules extend this with:
- `abi/` — Contract ABIs for on-chain interaction (Jaine, Slop)
- `subgraph/` — GraphQL clients for indexed data (Jaine)
- `ws-client.ts` — WebSocket streaming (DexScreener)
- `signing.ts` — Protocol-specific cryptographic signing (Polymarket CLOB)
- `auth.ts` — JWT/HMAC authentication flows (Slop, EchoBook, Polymarket)

---

## Chain Coverage

| Chain Family | Chains | Protocols |
|-------------|--------|-----------|
| **0G Network** | 0G Mainnet (16661) | Jaine, Slop, ChainScan, 0G Compute, 0G Storage, EchoBook |
| **EVM** | Ethereum, Polygon, Arbitrum, Optimism, BSC, Avalanche, Base, + 11 more | KyberSwap, Khalani, Polymarket, DexScreener |
| **Solana** | Solana Mainnet | Jupiter (swap, lend, predict, prices, tokens) |

---

## External Docs

| Protocol | Official docs |
|----------|--------------|
| Jupiter | https://dev.jup.ag/docs/llms.txt |
| Khalani | https://khalani.gitbook.io/khalani-docs |
| KyberSwap | https://docs.kyberswap.com/ |
| Polymarket | https://docs.polymarket.com/api-reference/introduction |
| DexScreener | https://docs.dexscreener.com/api/reference |

---

## Dependencies Shared Across Modules

| Dependency | Used by |
|-----------|---------|
| `viem` | Wallet, Jaine, Slop, Khalani, KyberSwap, Polymarket (EVM reads/writes) |
| `@solana/web3.js` | Wallet, Jupiter, Khalani-Solana |
| `config/store.ts` | Every module (service URLs, contract addresses) |
| `utils/http.ts` | Every REST client |
| `utils/rateLimit.ts` | ChainScan, Jaine subgraph, KyberSwap |
| `errors.ts` | Every module (VexError with domain-specific codes) |
