---
id: module.src-root.tools-kyberswap
kind: module
paths:
  - "src/tools/kyberswap/**"
source_commit: 152af27
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/tools/kyberswap/**"
  - "src/vex-agent/tools/protocols/kyberswap/**"
  - "src/vex-agent/tools/protocols/mutation-matrix.ts"
  - "src/config/store.ts"
related:
  - module.vex-agent.tools-protocols
  - module.src-root.lib-wallet
  - module.src-root.lib-db-utilities
---

# module.src-root.tools-kyberswap — KyberSwap Multi-Chain EVM Client Library

## Purpose

Pure HTTP + on-chain client library for KyberSwap DeFi services: token-swap aggregation
across 400+ DEXs, gasless EIP-712 limit orders, ZaaS concentrated-liquidity provisioning
(zap in/out/migrate), and token safety checks. Covers 20 EVM chains. Consumed exclusively
by the vex-agent protocol handler layer (`src/vex-agent/tools/protocols/kyberswap/`) via
`@tools/kyberswap` alias; no direct vex-app or renderer consumers. The library is a
Z5 shared utility — all business logic, approval routing, and signing are caller-owned.

## Retrieval keywords

- kyberswap, aggregator swap, limit order, zap, ZaaS, liquidity provisioning
- EIP-712 signing, gasless limit order, concentrated LP, zap-in, zap-out, zap-migrate
- ERC-20 approve, ERC-721 approve, ERC-1155 setApprovalForAll, USDT reset allowance
- token search, honeypot check, fee-on-transfer, spender allowlist
- NFT mint extraction, receipt logs, position ID, ERC-721 Transfer event
- KyberChainSlug, KyberChainFeatures, NFPM registry, 5-axis position model
- swap route, buildRoute, MetaAggregationRouterV2, DSLOProtocol, KSZapRouterPosition

## State owned

- **No DB state.** The library makes no DB calls.
- **In-process caches only** (module-level singletons, invalidated on URL change):
  - `KyberAggregatorClient` — singleton keyed on `kyberswapAggregatorUrl` from `config.json`
  - `KyberLimitOrderClient` — singleton keyed on `kyberswapLimitOrderUrl`
  - `KyberLimitOrderTakerClient` — singleton keyed on `kyberswapLimitOrderUrl`
  - `KyberZaasClient` — singleton keyed on `kyberswapZaasUrl`
  - `KyberTokenApiClient` — singleton keyed on `kyberswapTokenApiUrl`
  - `KyberCommonClient` — singleton keyed on `kyberswapCommonServiceUrl`
  - `cachedDynamicChains` + `cacheTimestamp` (`chains.ts:119–133`) — 1h in-memory TTL for
    Common Service supported-chains list; cleared by `clearDynamicChainsCache()`

## Boundary crossings

| Direction | Boundary |
|-----------|----------|
| Network: KyberSwap Aggregator | `aggregator-api.kyberswap.com` — GET route, POST build |
| Network: KyberSwap Token API | `token-api.kyberswap.com` — token search, honeypot/FOT check |
| Network: KyberSwap Common Service | `common-service.kyberswap.com` — dynamic supported-chains |
| Network: KyberSwap Limit Order | `limit-order.kyberswap.com` — maker + taker flows |
| Network: KyberSwap ZaaS | `zap-api.kyberswap.com` — zap in/out/migrate route + build |
| Chain RPC (write) | `evm/config.ts:DEFAULT_RPC` — `walletClient.writeContract` (ERC-20/721/1155 approve), `walletClient.sendTransaction` (swap/zap/cancel) |
| Chain RPC (read) | `evm/config.ts:DEFAULT_RPC` — `publicClient.readContract` (allowance, decimals, symbol), `waitForTransactionReceipt` |
| Config (read) | `config/store.ts:loadConfig().services.*` — all five base URLs resolved at singleton creation |
| Private key (transient) | `evm/config.ts:getKyberEvmClients` accepts `privateKey: Hex` from caller; never stored |

## File map

### Root
- `src/tools/kyberswap/types.ts:1` — `KyberChainSlug` (20-member union), `KyberChainId`, `KyberChainInfo`, `KyberChainFeatures`
- `src/tools/kyberswap/constants.ts:1` — base URLs, `META_AGGREGATION_ROUTER_V2`, `DSLO_PROTOCOL`, `KS_ZAP_ROUTER_POSITION`, `KS_ZAP_ROUTER_PERMIT`, `KYBER_KNOWN_SPENDERS` (Set<string> allowlist), per-client `*_TIMEOUT_MS`, `KYBER_CLIENT_ID="Vex"`, `NATIVE_TOKEN_ADDRESS`
- `src/tools/kyberswap/chains.ts:19` — `CHAINS` (static 20-entry feature matrix), `ALIASES` map, `slugMap`/`idMap` (O(1) lookups); `resolveChainSlug`, `chainIdToSlug`, `slugToChainId`, `getChainFeatures`, `chainSupportsFeature`; dynamic cache: `setCachedDynamicChains`, `getCachedDynamicChains`, `clearDynamicChainsCache` (1h TTL)
- `src/tools/kyberswap/errors.ts:10` — `mapKyberTransportError` — re-throws `KYBER_*` VexErrors as-is; maps `HTTP_TIMEOUT→KYBER_TIMEOUT`, `HTTP_REQUEST_FAILED→KYBER_API_ERROR`; used by all sub-clients
- `src/tools/kyberswap/helpers.ts:1` — `resolveChain`, `resolveChainWithId`, `requireFeature`; `resolveTokenAddress` (native/address/symbol via Token API); `resolveTokenMetadata` (tolerant: whitelisted-first Token API search then chain read-fallback); `resolveTokenMetadataStrict` (address-only, rejects symbol strings — required for all mutating tools)
- `src/tools/kyberswap/evm-utils.ts:1` — barrel re-export of `evm/config.ts`, `evm/erc20.ts`, `evm/nft.ts`, `evm/receipt-logs.ts`

### Aggregator (`aggregator/`)
- `src/tools/kyberswap/aggregator/client.ts:25` `KyberAggregatorClient` — `getRoute(chain, params): SwapRouteResponse` (GET `/{chain}/api/v1/routes`); `buildRoute(chain, body): SwapBuildResponse` (POST `/{chain}/api/v1/route/build`); `getKyberAggregatorClient()` singleton
- `src/tools/kyberswap/aggregator/types.ts:1` — `SwapRouteParams`, `SwapRouteSummary`, `SwapRouteResponse`, `SwapBuildRequest`, `SwapBuildResponse`
- `src/tools/kyberswap/aggregator/validation.ts` — runtime validators for route/build responses
- `src/tools/kyberswap/aggregator/errors.ts` — `mapAggregatorError` (KyberSwap error codes 4001–4221 → typed VexErrors)

### Limit Order (`limit-order/`)
- `src/tools/kyberswap/limit-order/client.ts:40` `KyberLimitOrderClient` — `getContractAddresses`, `getSignMessage` (POST → unsigned EIP-712), `createOrder` (POST → orderId), `getOrders`, `getActiveMakingAmount`, `getCancelSignMessage` (POST → unsigned EIP-712), `cancelOrders` (POST → gasless cancel), `encodeCancelBatch`, `encodeIncreaseNonce`; `getKyberLimitOrderClient()` singleton
- `src/tools/kyberswap/limit-order/taker-client.ts:19` `KyberLimitOrderTakerClient` — `getTradingPairs`, `getTakerOrders`, `getOperatorSignature`, `encodeFillOrder`, `encodeFillBatchOrders`; `getKyberLimitOrderTakerClient()` singleton
- **`src/tools/kyberswap/limit-order/signing.ts:19` `signEip712Message`** — load-bearing signing primitive: accepts `privateKey: Hex` + `LimitOrderEip712Message`, uses viem `signTypedData`, strips `EIP712Domain` from types (viem adds it internally). Applies to both order creation and gasless cancel. Security comment: "Must only be called AFTER --yes confirmation"
- `src/tools/kyberswap/limit-order/types.ts:1` — `LimitOrderSignMessageRequest`, `LimitOrderEip712Domain`, `LimitOrderEip712Message` (domain + types + primaryType + message with salt), `LimitOrderCreateRequest`, `LimitOrder`, `LimitOrderStatus`, `LimitOrderCancelSignRequest`, `OperatorSignatureResponse`, `FillOrderRequest`, `FillBatchOrdersRequest`, `EncodedCalldata`, `TradingPair`, `ContractAddresses`
- `src/tools/kyberswap/limit-order/validation.ts` — runtime validators
- `src/tools/kyberswap/limit-order/errors.ts` — `mapLimitOrderError` (signature/allowance/404/rate-limit patterns)

### Token API (`token-api/`)
- `src/tools/kyberswap/token-api/client.ts:17` `KyberTokenApiClient` — `searchTokens(chainIds, opts)` (GET `/api/v1/public/tokens`, whitelisted-first resolution pattern); `getHoneypotFotInfo(chainId, address)` (GET `/api/v1/public/tokens/honeypot-fot-info`); `getKyberTokenApiClient()` singleton
- `src/tools/kyberswap/token-api/types.ts` — `KyberToken`, `KyberTokenSearchResponse`, `HoneypotFotInfo`
- `src/tools/kyberswap/token-api/validation.ts` — runtime validators

### ZaaS (`zaas/`)
- `src/tools/kyberswap/zaas/client.ts:31` `KyberZaasClient` — `getZapInRoute`, `buildZapIn`, `getZapOutRoute`, `buildZapOut`, `getZapMigrateRoute`, `buildZapMigrate` (6 endpoints across 3 zap directions, rate limit: 10 req/10s per X-Client-Id); `getKyberZaasClient()` singleton
- `src/tools/kyberswap/zaas/types.ts:1` — `ZapInRouteParams`, `ZapOutRouteParams`, `ZapMigrateRouteParams`, `ZapRouteResponse`, `ZapDetails`, `ZapAction`, `ZapBuildRequest`, `ZapBuildOutRequest`, `ZapBuildMigrateRequest`, `ZapBuildResponse`
- `src/tools/kyberswap/zaas/validation.ts` — runtime validators for zap route and build
- `src/tools/kyberswap/zaas/errors.ts` — `mapZaasError` (400/404/429/5xx)
- `src/tools/kyberswap/zaas/zap-dexes/types.ts:8` — 5-axis position model types: `PositionRefKind`, `ApprovalStandard`, `ApprovalTargetKind`, `CaptureKind`, `PositionKeyStrategy`, `ZapDexEntry`, `ChainZapDexConfig`
- `src/tools/kyberswap/zaas/zap-dexes/index.ts:23` — `CATALOG: Map<chain, ChainZapDexConfig>` (13 ZaaS chains); `getZapDexConfig(chain)`, `getSupportedZapChains()`
- `src/tools/kyberswap/zaas/zap-dexes/nfpm-registry.ts:14` — `NFPM: ReadonlyMap<"chain:dexId", address>` (~30 entries); `getNfpm(chain, dexId)`; shared 5-axis tuples: `NFT_CL`, `V2_BASIC`, `VAULT_SHARE`, `SOURCE_ONLY_SHARE`
- ZaaS DEX chain configs (single-line catalog — structure only, not deep-indexed):
  - `zaas/zap-dexes/chains/arbitrum.ts` — `ARBITRUM_ZAP_DEXES`
  - `zaas/zap-dexes/chains/avalanche.ts` — `AVALANCHE_ZAP_DEXES`
  - `zaas/zap-dexes/chains/base.ts` — `BASE_ZAP_DEXES`
  - `zaas/zap-dexes/chains/berachain.ts` — `BERACHAIN_ZAP_DEXES`
  - `zaas/zap-dexes/chains/bsc.ts` — `BSC_ZAP_DEXES`
  - `zaas/zap-dexes/chains/ethereum.ts` — `ETHEREUM_ZAP_DEXES`
  - `zaas/zap-dexes/chains/linea.ts` — `LINEA_ZAP_DEXES`
  - `zaas/zap-dexes/chains/optimism.ts` — `OPTIMISM_ZAP_DEXES`
  - `zaas/zap-dexes/chains/polygon.ts` — `POLYGON_ZAP_DEXES`
  - `zaas/zap-dexes/chains/ronin.ts` — `RONIN_ZAP_DEXES`
  - `zaas/zap-dexes/chains/scroll.ts` — `SCROLL_ZAP_DEXES`
  - `zaas/zap-dexes/chains/sonic.ts` — `SONIC_ZAP_DEXES`
  - `zaas/zap-dexes/chains/zksync.ts` — `ZKSYNC_ZAP_DEXES`

### Common Service (`common/`)
- `src/tools/kyberswap/common/client.ts:17` `KyberCommonClient` — `getSupportedChains()` with 1h cache via `setCachedDynamicChains`/`getCachedDynamicChains`; `getKyberCommonClient()` singleton
- `src/tools/kyberswap/common/validation.ts` — runtime validator

### EVM Layer (`evm/`)
- `src/tools/kyberswap/evm/config.ts:23` — `ERC20_ABI` (allowance/approve/decimals/symbol/name); `DEFAULT_RPC: Record<KyberChainSlug, string>` (20 chains, publicnode.com / chain-native RPC); `toViemChain(slug): Chain`; `getKyberEvmClients(slug, privateKey): {publicClient, walletClient}` (viem, timeout=30s, retryCount=2); `getKyberPublicClient(slug)` (read-only)
- `src/tools/kyberswap/evm/erc20.ts:40` — `readErc20Metadata` (tolerant: decimals mandatory, symbol/name optional); **`validateKyberSpender`** (KYBER_KNOWN_SPENDERS allowlist check — called before every approve); `verifyRouterAddress` (API-returned router vs hardcoded constant); **`ensureKyberAllowance`** (USDT-safe: reset-to-0 if current>0 and <required, then approve maxUint256 or exact); **`sendKyberTransaction`** (walletClient.sendTransaction + waitForReceipt); **`sendKyberTransactionWithReceipt`** (returns hash + logs for NFT position ID extraction)
- `src/tools/kyberswap/evm/nft.ts:47` — **`ensureErc721Approval`** (isApprovedForAll check first, then per-token getApproved, then approve(spender, tokenId) — validates spender against allowlist); **`ensureErc1155ApprovalForAll`** (isApprovedForAll check, then setApprovalForAll — validates operator against allowlist)
- `src/tools/kyberswap/evm/receipt-logs.ts:20` — **`extractMintedNftId`** (two-pass: direct mint from=0x0 first, then router-intermediated; 4-topic ERC-721 only; `expectedContract` filter); **`extractErc1155Position`** (TransferSingle `to=recipient` → first 32 bytes of data; TransferBatch → ABI-decoded first id)

## Key types & invariants

- `KyberChainSlug` (`types.ts:7`) — 20-member literal union; `KyberChainId` mirrors numerically. All sub-clients take `slug` for the chain path parameter.
- `KyberChainFeatures` (`types.ts:30`) — `{ slug, chainId, name, aggregator: boolean, limitOrder: boolean, zaas: boolean }`. Feature gates: `requireFeature(slug, feature)` throws `KYBER_UNSUPPORTED_CHAIN` (not a soft no-op). Mantle/Unichain/HyperEVM/Plasma/Etherlink/Monad/MegaETH have `zaas:false`; Scroll/zkSync have `aggregator:false`/`limitOrder:false`.
- `LimitOrderEip712Message` (`limit-order/types.ts:32`) — `{ domain, types, primaryType, message: { salt, ... } }`. `salt` is mandatory and round-tripped verbatim into `LimitOrderCreateRequest` (required for signature verification). `EIP712Domain` key present in `types` is stripped by `signEip712Message` before passing to viem.
- `KYBER_KNOWN_SPENDERS` (`constants.ts:47`) — `Set<string>` (lowercase addresses): MetaAggregationRouterV2, DSLOProtocol, KSZapRouterPosition, KSZapRouterPermit. `validateKyberSpender` throws `INVALID_SPENDER` if not in set. This is the primary blast-radius control for ERC-20/721/1155 approvals.
- `ZapDexEntry` (`zap-dexes/types.ts:59`) — 5-axis position model: `positionRefKind`, `approvalStandard`, `approvalTargetKind`, `captureKind`, `positionKeyStrategy`, plus optional `positionManagerAddress` (NFPM address; required when `approvalTargetKind==="positionManager"`). Handlers import these at runtime via dynamic `import("@tools/kyberswap/zaas/zap-dexes/index.js")`.
- **Strict token resolution invariant**: `resolveTokenMetadataStrict` (used by all mutating swap/order handlers) rejects non-address inputs with `KYBER_TOKEN_NOT_FOUND`. Symbols must be pre-resolved via `khalani.tokens.search` before reaching mutating tools.
- `NFPM: ReadonlyMap` (`nfpm-registry.ts:14`) — `"chain:dexId" → address`. `getNfpm` returns `undefined` for unregistered pairs — callers must handle the missing-NFPM case (no implicit fallback to pool address).
- Singleton clients are recreated only when the base URL from `config.json` changes. URL changes after first call within a process require a new process or manual `clearDynamicChainsCache()` call.

## Capabilities (stable IDs)

- **CAP-kyberswap-aggregator-getroute**: GET swap route (read) — `aggregator/client.ts:86 KyberAggregatorClient.getRoute`
- **CAP-kyberswap-aggregator-buildroute**: POST build encoded swap calldata (read, no signing) — `aggregator/client.ts:110 KyberAggregatorClient.buildRoute`
- **CAP-kyberswap-aggregator-swap-execute**: ERC-20 approve + send swap tx (MUTATING) — `evm/erc20.ts:128 ensureKyberAllowance` + `evm/erc20.ts:196 sendKyberTransaction`; called from `src/vex-agent/tools/protocols/kyberswap/handlers/swap.ts:80,91`
- **CAP-kyberswap-limit-order-sign**: EIP-712 sign for order create or gasless cancel (MUTATING — private key) — `limit-order/signing.ts:19 signEip712Message`
- **CAP-kyberswap-limit-order-create**: Submit signed maker order to orderbook (MUTATING) — `limit-order/client.ts:98 KyberLimitOrderClient.createOrder`; called from `src/vex-agent/tools/protocols/kyberswap/handlers/limit-order.ts:125`
- **CAP-kyberswap-limit-order-cancel-gasless**: EIP-712 sign + submit gasless cancel (MUTATING) — `limit-order/client.ts:115 getCancelSignMessage` + `limit-order/client.ts:120 cancelOrders`; called from `limit-order.ts:174`
- **CAP-kyberswap-limit-order-hardcancel**: encodeCancelBatch + on-chain sendTransaction to DSLO_PROTOCOL (MUTATING) — `limit-order/client.ts:124 encodeCancelBatch` + `evm/erc20.ts:196 sendKyberTransaction`; called from `limit-order.ts:194`
- **CAP-kyberswap-limit-order-fill**: encodeFillOrder + on-chain send (MUTATING) — `limit-order/taker-client.ts:87 encodeFillOrder` + `sendKyberTransaction`; called from `limit-order.ts:264,315`
- **CAP-kyberswap-limit-order-batchfill**: encodeFillBatchOrders + on-chain send (MUTATING) — `limit-order/taker-client.ts:94 encodeFillBatchOrders` + `sendKyberTransaction`; called from `limit-order.ts:350`
- **CAP-kyberswap-zaas-zap-in**: approve + buildZapIn + sendTransactionWithReceipt + NFT mint extraction (MUTATING) — `zaas/client.ts:99 getZapInRoute`, `zaas/client.ts:105 buildZapIn`, `evm/erc20.ts:128 ensureKyberAllowance`, `evm/erc20.ts:220 sendKyberTransactionWithReceipt`; called from `zap.ts:146,149,150`
- **CAP-kyberswap-zaas-zap-out**: approve + buildZapOut + sendTransaction (MUTATING) — `zaas/client.ts:112 getZapOutRoute`, `zaas/client.ts:119 buildZapOut`; called from `zap.ts:238,247,248`
- **CAP-kyberswap-zaas-zap-migrate**: approve + buildZapMigrate + sendTransactionWithReceipt (MUTATING) — `zaas/client.ts:125 getZapMigrateRoute`, `zaas/client.ts:132 buildZapMigrate`; called from `zap.ts:322,331,332`
- **CAP-kyberswap-token-search**: token symbol/name/decimals/honeypot search (read) — `token-api/client.ts:38 KyberTokenApiClient.searchTokens`
- **CAP-kyberswap-token-honeypot**: honeypot/FOT safety check (read) — `token-api/client.ts:80 KyberTokenApiClient.getHoneypotFotInfo`
- **CAP-kyberswap-chains-list**: static 20-chain registry + dynamic supported-chains via Common Service (read) — `chains.ts:69 getKyberChains`, `common/client.ts:24 KyberCommonClient.getSupportedChains`
- **CAP-kyberswap-zaas-dex-catalog**: DEX + NFPM + 5-axis tuple lookup per chain (read, static) — `zaas/zap-dexes/index.ts:39 getZapDexConfig`, `zaas/zap-dexes/nfpm-registry.ts:71 getNfpm`
- **CAP-kyberswap-erc20-metadata**: on-chain ERC-20 decimals/symbol/name read (read) — `evm/erc20.ts:40 readErc20Metadata`
- **CAP-kyberswap-receipt-nft-extract**: extract NFT tokenId from tx receipt logs (pure, no I/O) — `evm/receipt-logs.ts:20 extractMintedNftId`, `evm/receipt-logs.ts:66 extractErc1155Position`

## Public API (consumed by)

- `src/vex-agent/tools/protocols/kyberswap/handlers/swap.ts` → `getKyberAggregatorClient`, `getKyberTokenApiClient`, `getKyberCommonClient`, `getKyberChains`, `resolveChainSlug`, `slugToChainId`, `ensureKyberAllowance`, `sendKyberTransaction`, `META_AGGREGATION_ROUTER_V2`, `NATIVE_TOKEN_ADDRESS`, `resolveTokenMetadata`, `resolveTokenMetadataStrict`, `requireFeature`, `resolveChainWithId`
- `src/vex-agent/tools/protocols/kyberswap/handlers/limit-order.ts` → `getKyberLimitOrderClient`, `getKyberLimitOrderTakerClient`, `signEip712Message`, `sendKyberTransaction`, `ensureKyberAllowance`, `ensureErc721Approval`, `DSLO_PROTOCOL`, `resolveTokenMetadataStrict`, `requireFeature`, `resolveChainWithId`
- `src/vex-agent/tools/protocols/kyberswap/handlers/zap.ts` → `getKyberZaasClient`, `ensureKyberAllowance`, `sendKyberTransaction`, `sendKyberTransactionWithReceipt`, `ensureErc721Approval`, `ensureErc1155ApprovalForAll`, `KS_ZAP_ROUTER_POSITION`, `NATIVE_TOKEN_ADDRESS`, `resolveChainSlug`, `requireFeature`, `ZapDexEntry`, `ZapRouteResponse`; dynamic imports `getZapDexConfig`
- `src/vex-agent/tools/internal/evm-read.ts` → `extractMintedNftId` (via `@tools/kyberswap/evm-utils.js`)
- `src/vex-agent/sync/lp-economics.ts` → `ZapDetails`, `ZapAction` (type-only)
- `src/vex-agent/sync/projectors/lp.ts` → `ZapDetails` (type-only, inline import)
- **No vex-app/src/renderer or vex-app/src/main consumers** — all access is through the engine protocol layer.

## Internal flow

### Swap sell (aggregator mutating path)

```
handler/swap.ts:
  1. resolveChainWithId(p.chain) → { slug, chainId }
  2. requireFeature(slug, "aggregator")
  3. resolveTokenMetadataStrict(p.tokenIn, chainId)   ← rejects symbols
  4. resolveTokenMetadataStrict(p.tokenOut, chainId)
  5. getKyberAggregatorClient().getRoute(slug, { tokenIn, tokenOut, amountIn })
     → SwapRouteResponse.data.{ routeSummary, routerAddress }
  6. verifyRouterAddress(routerAddress, META_AGGREGATION_ROUTER_V2)   ← hardcoded check
  7. getKyberEvmClients(slug, signer.privateKey)
  8. ensureKyberAllowance(publicClient, walletClient, tokenIn, routerAddress, amountIn)
     → validateKyberSpender(routerAddress)   ← allowlist check
     → if needsReset: walletClient.writeContract approve(spender, 0n) + waitForReceipt
     → walletClient.writeContract approve(spender, maxUint256) + waitForReceipt
  9. getKyberAggregatorClient().buildRoute(slug, { routeSummary, sender, recipient, ... })
  10. sendKyberTransaction({ to: routerAddress, data, value })
      → walletClient.sendTransaction + publicClient.waitForTransactionReceipt
      → return txHash
```

### Limit-order create (EIP-712 mutating path)

```
handler/limit-order.ts:
  1. resolveChainWithId + requireFeature("limitOrder")
  2. resolveTokenMetadataStrict(makerAsset/takerAsset)
  3. getKyberLimitOrderClient().getSignMessage({ chainId, makerAsset, takerAsset, maker, amounts, expiredAt })
     → LimitOrderEip712Message (unsigned, contains salt)
  4. ensureKyberAllowance(token=makerAsset, spender=DSLO_PROTOCOL, amount)
     → validateKyberSpender(DSLO_PROTOCOL)
  5. signEip712Message(signer.privateKey, eip712)
     → privateKeyToAccount(privateKey)
     → client.signTypedData({ domain, types (EIP712Domain stripped), primaryType, message })
     → Hex signature
  6. getKyberLimitOrderClient().createOrder({ ...params, salt, signature })
     → POST /write/api/v1/orders → { orderId }
```

### ZaaS zap-in (concentrated LP add, mutating path)

```
handler/zap.ts (zap-in branch):
  1. resolveChainSlug + requireFeature("zaas")
  2. dynamic import getZapDexConfig(slug) → ZapDexEntry
  3. getKyberZaasClient().getZapInRoute(slug, { dex, pool.id, tokensIn, amountsIn, slippage })
     → ZapRouteResponse.data.{ route, routerAddress, zapDetails }
  4. verifyRouterAddress(routerAddress, KS_ZAP_ROUTER_POSITION)
  5. ensureKyberAllowance(tokenIn, routerAddress, amountIn)
     → validateKyberSpender(routerAddress)
  6. getKyberZaasClient().buildZapIn(slug, { sender, recipient, route })
     → ZapBuildResponse.data.{ callData, routerAddress, value }
  7. sendKyberTransactionWithReceipt({ to: routerAddress, data: callData, value })
     → { hash: txHash, receipt: { logs } }
  8. extractMintedNftId(logs, recipientAddress, positionManagerAddress?)
     → tokenId string (or undefined if not NFT-based DEX)
```

## Dependencies

- **Imports FROM**:
  - `src/config/store.ts` — `loadConfig().services.*` for all base URLs
  - `src/errors.ts` — `VexError`, `ErrorCodes` (`KYBER_*`, `INVALID_SPENDER`, `APPROVAL_FAILED`, `SWAP_FAILED`)
  - `src/utils/http.ts` — `fetchWithTimeout`, `readJson`
  - `src/utils/logger.ts` — winston logger (structured events: `kyberswap.{aggregator,limit_order,zaas,token_api,common}.*`)
  - `src/utils/validation-helpers.ts` — `isRecord`
  - `viem`, `viem/accounts` — `createPublicClient`, `createWalletClient`, `privateKeyToAccount`, `signTypedData`, `writeContract`, `sendTransaction`, `waitForTransactionReceipt`, `getAddress`, `maxUint256`
- **Consumed BY**:
  - `module.vex-agent.tools-protocols` — `src/vex-agent/tools/protocols/kyberswap/handlers/{swap,limit-order,zap}.ts` via `@tools/kyberswap` alias
  - `src/vex-agent/tools/internal/evm-read.ts` — `extractMintedNftId`
  - `src/vex-agent/sync/lp-economics.ts`, `src/vex-agent/sync/projectors/lp.ts` — `ZapDetails`/`ZapAction` types only

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-kyberswap-*`
- quality findings: `audits/current/quality-findings.md#FINDING-*`
- related protocol module: `module.vex-agent.tools-protocols` (kyberswap manifest, handlers, mutation-matrix entries)
- execution context (signing + wallet resolution): `module.src-root.lib-wallet` (`tools/wallet/multi-auth.ts` provides `WalletResolution`; private key passed into this module's `getKyberEvmClients`)

## Refresh triggers

Stale when any of these paths change since `source_commit`:
- `src/tools/kyberswap/**` — any new endpoint, type, chain, DEX config, or security change
- `src/vex-agent/tools/protocols/kyberswap/**` — handler changes that add new import surface
- `src/vex-agent/tools/protocols/mutation-matrix.ts` — if kyberswap capture contracts change
- `src/config/store.ts` — if service URL fields are renamed/added

## Open questions

1. **`KSZapRouterPermit` not in KYBER_KNOWN_SPENDERS on Linea/Sonic/Ronin**: `constants.ts:44` notes the permit router is "not deployed on Linea, Sonic, Ronin" yet its address is still in `KYBER_KNOWN_SPENDERS`. The allowlist check passes for all chains — if a handler were to pass this address on a chain where it isn't deployed, the allowlist would not catch it. Worth adding a chain-aware spender check (or at least a comment).
2. **`getKyberPublicClient` creates a new client on every call** (no caching): `evm/config.ts:136`. For on-chain metadata reads (`readErc20Metadata`), this creates a fresh viem transport per call. Low-risk for infrequent metadata reads but could be noisy under high call volume.
3. **`DEFAULT_RPC` uses public third-party endpoints** (publicnode.com + chain-native): No authentication, no rate-limit handling beyond viem retryCount=2. Heavy use under mission autonomous mode could hit public RPC limits. A configurable RPC map in `config.json` (similar to `kyberswapAggregatorUrl`) would allow operator override.
4. **ZaaS rate limit (10 req/10s per X-Client-Id)** is documented in the client comment but not enforced in code. Under concurrent zap operations the client would receive 429s that propagate as `KYBER_RATE_LIMITED`. No retry/backoff logic exists at this layer — callers must handle.
5. **NFPM registry last verified 2026-04-04** (`nfpm-registry.ts:9`): static embedded addresses. New chain/DEX deployments (Berachain expansion, Unichain ZaaS, etc.) require manual update. No staleness detection.
