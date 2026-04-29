# Jaine — 0G Network DEX (Uniswap V3 Fork)

> On-chain DEX operations on 0G Network: token resolution, pool discovery (on-chain scan + Goldsky subgraph), multi-hop routing with on-chain quoting, ERC20 allowance management, and user token aliases. Uniswap V3 architecture (concentrated liquidity, fee tiers, encoded paths).
>
> **Last updated: 2026-03-30**
>
> **LLM maintainers:** If you modify any file in this folder, update this document to reflect the change — add/remove files, update descriptions, fix stale references.

---

## Directory Structure

```
src/tools/jaine/
  coreTokens.ts     — 12 core tokens on 0G mainnet, resolveToken(), getTokenSymbol()
  paths.ts          — Jaine data dir (~/.vex/jaine/), pool cache + token file paths
  pathEncoding.ts   — Uniswap V3 path encoding/decoding (token+fee bytes), formatPath()
  routing.ts        — BFS route finder + on-chain quoting (exactInput/exactOutput)
  poolCache.ts      — Pool discovery: on-chain factory scan + Goldsky subgraph sync, cache persistence
  allowance.ts      — ERC20 approve/revoke with USDT-style reset handling, spender allowlist
  userTokens.ts     — User-defined token aliases (persistent, merged with core tokens)
  abi/              — Contract ABIs
    erc20.ts        — Extended ERC20 ABI (balanceOf, approve, allowance, transfer, decimals, symbol, name)
    factory.ts      — Jaine V3 Factory (getPool), fee tiers: 100, 500, 3000, 10000
    router.ts       — Jaine V3 Router (exactInput, exactOutput, multicall)
    quoter.ts       — Jaine V3 Quoter (quoteExactInput, quoteExactOutput)
    pool.ts         — Pool ABI (slot0, liquidity, fee, token0/1)
    nftManager.ts   — NFT Position Manager (mint, collect, burn LP positions)
    w0g.ts          — W0G wrapper (deposit/withdraw native 0G ↔ W0G)
    index.ts        — Re-exports
  subgraph/         — Goldsky subgraph client (Jaine V3 indexed data)
    constants.ts    — Defaults: URL, timeout 15s, rate limit 5/s, max concurrent 2
    types.ts        — GraphQL response types: Pool, Swap, Mint, Burn, Collect, Token, DayData
    queries.ts      — 15 GraphQL query strings (pools, swaps, mints, burns, tokens, day/hour data)
    client.ts       — subgraphClient singleton with rate limiting + retry
```

---

## Core Tokens (`coreTokens.ts`)

12 tokens hardcoded for 0G mainnet:

| Symbol | Purpose |
|--------|---------|
| USDC, stgUSDT, stgUSDC, oUSDT | Stablecoins |
| w0G, st0G | Native 0G wrappers |
| WETH, wstETH | Ethereum bridged |
| coinbaseBTC | Bitcoin bridged |
| PAI, LINK, HAIO | Protocol tokens |

`resolveToken(symbolOrAddress)` — case-insensitive symbol lookup → checksummed address. User aliases checked first.

---

## Routing (`routing.ts`)

BFS-based multi-hop router with on-chain quote verification:

```
findBestRouteExactInput(tokenIn, tokenOut, amountIn)
  ├── Load pool cache (local JSON)
  ├── Build pool graph (bidirectional edges by token pair)
  ├── BFS: find all routes up to 3 hops, max 20 candidates
  ├── Quote each route via Quoter contract (batches of 5)
  └── Sort by amountOut descending, then fewer hops
```

Also `findBestRouteExactOutput()` — minimizes input for desired output.

### Path Encoding (`pathEncoding.ts`)

Uniswap V3 path format: `token0 (20B) + fee0 (3B) + token1 (20B) + fee1 (3B) + ...`

- `encodePath(tokens, fees)` — for exactInput
- `encodePathForExactOutput(tokens, fees)` — reversed for exactOutput
- `decodePath(path)` → `{ tokens, fees }`

---

## Pool Discovery (`poolCache.ts`)

Two strategies for building the pool cache:

| Strategy | Function | Source | Speed |
|----------|----------|--------|-------|
| On-chain scan | `scanCorePools()` | Factory contract `getPool()` | Slow (N² × fee tiers) |
| Subgraph sync | `syncPoolsFromSubgraph()` | Goldsky indexed data | Fast (single query, top 500 by TVL) |

Cache stored in `~/.vex/jaine/pools-cache.v1.json` (atomic write, version + chainId validated on load).

Helper queries: `findPoolsForToken()`, `findPoolsBetweenTokens()`.

---

## Allowance Management (`allowance.ts`)

Only two spenders allowed (hardcoded allowlist):
- `router` — Jaine V3 Router
- `nft` — NFT Position Manager

| Function | Purpose |
|----------|---------|
| `getAllowance(token, owner, spender)` | Read current allowance |
| `getAllAllowances(token, owner)` | Both spenders in parallel |
| `safeApprove(token, spender, amount, key)` | Approve with USDT-style reset (set to 0 first if needed) |
| `revokeApproval(token, spender, key)` | Set allowance to 0 |
| `ensureAllowance(token, spender, required, key)` | Approve only if insufficient (maxUint256 or exact) |

---

## Subgraph Client (`subgraph/client.ts`)

Goldsky-hosted Jaine V3 subgraph. Rate-limited (5 req/s, max 2 concurrent), retry on 429/5xx/timeout.

| Method | Query | Returns |
|--------|-------|---------|
| `getMeta()` | `_meta` | Block number, deployment, indexing errors |
| `getTopPools(limit)` | Pools by TVL desc | `SubgraphPool[]` |
| `getPoolsForToken(token)` | Pools containing token | `SubgraphPool[]` |
| `getPoolsForPair(a, b)` | Pools for token pair | `SubgraphPool[]` |
| `getNewestPools(limit)` | Recently created | `SubgraphPool[]` |
| `getPool(id)` | Single pool | `SubgraphPool` |
| `getPoolDayData(poolId)` | Daily OHLCV | `SubgraphPoolDayData[]` |
| `getPoolHourData(poolId)` | Hourly OHLCV | `SubgraphPoolHourData[]` |
| `getRecentSwaps(poolId)` | Recent swaps | `SubgraphSwap[]` |
| `getMints(poolId)` | LP mints | `SubgraphMint[]` |
| `getBurns(poolId)` | LP burns | `SubgraphBurn[]` |
| `getCollects(poolId)` | Fee collects | `SubgraphCollect[]` |
| `getDexDayData(limit)` | DEX-wide daily stats | `SubgraphDexDayData[]` |
| `getToken(id)` | Token info | `SubgraphToken` |
| `getTopTokens(opts)` | By TVL or volume | `SubgraphToken[]` |

---

## User Tokens (`userTokens.ts`)

Persistent custom aliases stored in `~/.vex/jaine/tokens.json`. Merged with core tokens (user aliases take priority).

| Function | Purpose |
|----------|---------|
| `loadUserTokens()` | Load from disk |
| `addUserAlias(symbol, address)` | Add/update alias |
| `removeUserAlias(symbol)` | Delete alias |
| `getMergedTokens()` | Core + user merged |

---

## Dependencies

| Module | What's used |
|--------|-------------|
| `viem` | Address ops, path encoding (`concat`, `pad`, `toHex`), contract reads/writes |
| `tools/wallet/client.ts` | `getPublicClient()` — viem read client |
| `tools/wallet/signingClient.ts` | `getSigningClient()` — viem write client |
| `config/store.ts` | Protocol addresses, subgraph URL |
| `config/paths.ts` | `CONFIG_DIR`, `STORAGE_DRIVE_FILE` |
| `utils/rateLimit.ts` | TokenBucket, ConcurrencyLimiter |
| `utils/minimatch.ts` | Not used here (used by drive-index) |

---

## CLI Entry Point

`commands/jaine/` — tokens, pools, w0g, allowance, swap, lp, subgraph.

---

## Tests

```bash
npx vitest run src/__tests__/subgraph/
```

| File | Coverage |
|------|----------|
| `subgraph-client.test.ts` | GraphQL client, rate limiting, retry, all query methods |
| `subgraph-sync.test.ts` | Pool sync from subgraph |
