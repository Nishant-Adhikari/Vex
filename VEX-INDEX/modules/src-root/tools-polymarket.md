---
id: module.src-root.tools-polymarket
kind: module
paths:
  - "src/tools/polymarket/**"
source_commit: 152af27
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/tools/polymarket/**"
  - "src/lib/polymarket.ts"
  - "src/tools/wallet/polymarket-credentials.ts"
related:
  - module.vex-agent.tools-protocols
  - module.src-root.lib-wallet
  - module.src-root.lib-vault-secrets
  - module.src-root.lib-db-utilities
---

# module.src-root.tools-polymarket — Polymarket Protocol Client Library

## Purpose

Pure HTTP/WebSocket client library for every Polymarket service (CLOB, Gamma, Data,
Bridge, Relayer). Owns HMAC-SHA256 request signing, per-wallet credential lookup,
EIP-712 CTF Exchange order signing (viem `signTypedData`), and USDC.e approval helpers
for the Polygon chain. Consumed almost entirely by `src/vex-agent/tools/protocols/polymarket/`
handlers (Z3) at agent runtime; also exposed to vex-app main (`@vex-lib/polymarket.js`)
for onboarding setup and unlock sessions. Does NOT own credential DERIVATION or vault
persistence — those live in `src/tools/wallet/polymarket-credentials.ts` (out of scope).

## Retrieval keywords

- Polymarket CLOB, HMAC-SHA256 signing, EIP-712 ClobAuth, CTF Exchange, prediction market
- USDC.e approval, Polygon, CTF order, neg-risk market, orderbook
- Gamma API, Data API, Bridge deposit, Relayer submit
- per-wallet credentials, POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS, requirePolyClobCredentials
- WebSocket, order stream, user channel, market channel, ping/pong
- buildClobOrder, signClobOrder, buildClobHeaders, PolyClobClient, PolyBridgeClient

## State owned

No DB tables. All state is either:

- **Process env** (`process.env`): five vault-injected keys consumed read-only at call
  time — `POLYMARKET_API_KEY`, `POLYMARKET_API_SECRET`, `POLYMARKET_PASSPHRASE` (legacy
  primary-only fallback), `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS` (JSON map, per-wallet).
  Written only by `vex-app/src/main/secrets/session.ts:applyUnlockedRuntime` at vault
  unlock — this module never writes env.
- **Module-level singleton caches** (three separate `let cachedClient | null` variables):
  `PolyClobClient`, `PolyGammaClient`, `PolyDataClient`. `PolyBridgeClient` and
  `PolyRelayerClient` have simpler singletons (no URL comparison). Singletons are
  intentionally NOT reset on vault unlock; they re-read config lazily on construction.

## Boundary crossings

| Direction | Boundary |
|-----------|----------|
| Outbound — CLOB | HTTPS `clob.polymarket.com` + WSS `ws-subscriptions-clob.polymarket.com/ws/user` |
| Outbound — Gamma | HTTPS `gamma-api.polymarket.com` |
| Outbound — Data | HTTPS `data-api.polymarket.com` |
| Outbound — Bridge | HTTPS `bridge.polymarket.com` |
| Outbound — Relayer | HTTPS `relayer-v2.polymarket.com` |
| Outbound — Polygon RPC | HTTPS `polygon-bor-rpc.publicnode.com` (ERC-20 `allowance`/`approve` via viem) |
| Config read | `config/store.ts:loadConfig()` — reads `polymarket.{clobBaseUrl,gammaBaseUrl,dataApiBaseUrl}` overrides from `config.json` (if set) |
| Env read | `process.env[POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS]`, legacy triad — vault-injected, read-only here |
| Wallet read (auth only) | `tools/wallet/inventory.ts:getPrimaryEvmAddress()` — used ONLY for legacy primary-wallet fallback in `requirePolyClobCredentials`; no private key access in this module |
| Private key (signing) | `clob/signing.ts:signClobOrder` — accepts raw `Hex` private key from the caller (handler supplies it from session-scoped wallet resolution); `evm-utils.ts:getPolygonClients` — same pattern for `approve` flows |
| Logging | `utils/logger.ts` (winston) — structured events under `polymarket.{clob,gamma,data,bridge,relayer}.*` |

## File map

### Shared infrastructure

- `src/tools/polymarket/constants.ts:1` — all base URLs, chain constants (Polygon 137,
  `POLYGON_RPC`), token addresses (`USDC_E_ADDRESS` 6 decimals), contract addresses
  (`CTF_EXCHANGE`, `NEG_RISK_CTF_EXCHANGE`, `CONDITIONAL_TOKENS`), spender allowlist
  (`POLY_KNOWN_SPENDERS`), timeout constants (10–20 s per service), env var name constants.
  Key exports: `CLOB_BASE_URL`, `CTF_EXCHANGE`, `NEG_RISK_CTF_EXCHANGE`, `POLY_KNOWN_SPENDERS`,
  `ENV_POLYMARKET_API_KEY`, `ENV_POLYMARKET_API_SECRET`, `ENV_POLYMARKET_PASSPHRASE`,
  `ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS`.
- `src/tools/polymarket/types.ts:1` — shared domain entities: `PolyEvent`, `PolyMarket`,
  `PolyTag`, `PolyProfile`. All fields `T | null` (Polymarket API is inconsistent).
- `src/tools/polymarket/errors.ts:1` — `mapPolyTransportError` (remaps HTTP timeout/generic
  to `POLYMARKET_TIMEOUT` / `POLYMARKET_API_ERROR`), `mapPolyApiError` (HTTP status → typed
  `VexError`: 429→`POLYMARKET_RATE_LIMITED` retryable, 401→`POLYMARKET_AUTH_FAILED`,
  404→`POLYMARKET_MARKET_NOT_FOUND`, 5xx→`POLYMARKET_API_ERROR` retryable).
- `src/tools/polymarket/helpers.ts:1` — pure JSON parsers: `parseOutcomePrices`,
  `parseOutcomes`, `parseClobTokenIds`. No network calls.
- `src/tools/polymarket/credential-map.ts:1` — **owned by lib-vault-secrets scope**; documented
  here only for the `auth.ts` consumption contract. Exports `StoredPolyCredentials` shape,
  `parseCredentialMapEnv` (fail-closed: malformed → throw, absent → `{}`),
  `buildPolymarketVaultUpdates` (pure merge logic, no vault writes), `serializeCredentialMap`,
  `withCredentialEntry`, `normalizePolyAddress` (checksum → lowercase). Zod-validated.

### Auth layer

- `src/tools/polymarket/auth.ts:34` `signClobRequest` — HMAC-SHA256 over
  `(timestamp + METHOD + path + body)` using `node:crypto`. Returns `{ timestamp, signature }`.
- `src/tools/polymarket/auth.ts:53` `buildClobHeaders` — composes HMAC result into
  the five required headers: `POLY_API_KEY`, `POLY_ADDRESS`, `POLY_SIGNATURE`,
  `POLY_PASSPHRASE`, `POLY_TIMESTAMP`.
- `src/tools/polymarket/auth.ts:108` `requirePolyClobCredentials(address)` — **key
  security surface**. Resolution order:
  1. `parseCredentialMapEnv(process.env[ENV_POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS])[normalizePolyAddress(address)]`
  2. Legacy primary-wallet fallback ONLY if address == primary AND all three fixed env keys present.
  Throws `POLYMARKET_NOT_CONFIGURED` when neither resolves. A malformed map propagates the
  `parseCredentialMapEnv` throw (fail closed — corruption surfaces, never silently skips).
- `src/tools/polymarket/auth.ts:135` `hasPolyClobCredentials(address)` — non-throwing
  wrapper over `requirePolyClobCredentials`. Used by `polymarket-setup` internal tool for
  the visibility gate.

### CLOB client (`clob/`)

- `src/tools/polymarket/clob/signing.ts:50` `buildClobOrder` — builds an unsigned
  `ClobOrder`-shaped object with random `salt` (crypto.Math.random * 2^32); sets
  `taker = "0x000...000"` (open order).
- `src/tools/polymarket/clob/signing.ts:87` `signClobOrder(privateKey, order, negRisk)` —
  **EIP-712 CTF Exchange signing**. Constructs viem `walletClient` from `privateKey`
  via `privateKeyToAccount`; selects domain between `CTF_EXCHANGE_DOMAIN` and
  `NEG_RISK_CTF_EXCHANGE_DOMAIN` based on `negRisk`; calls `signTypedData` over the
  12-field `Order` type (`salt/maker/signer/taker/tokenId/makerAmount/takerAmount/
  expiration/nonce/feeRateBps/side/signatureType`). Returns `Hex` signature.
  The `side` field is encoded as `uint8` (BUY=0, SELL=1) before signing.
- `src/tools/polymarket/clob/client.ts:43` `PolyClobClient` — stateless singleton class.
  `requestPublic` (market data, no auth). `requestAuth` (trading): calls
  `requirePolyClobCredentials(auth.address)` per request — no auth caching on the
  instance. HMAC signs path only (not query), per Polymarket spec (`path, not path+query`).
  Public surface: orderbook (`getOrderBook`, `getMidpoint`, `getSpread`, `getLastTradePrice`,
  `getPriceHistory`, `getTickSize`, `getFeeRate`, `getServerTime`), batch variants,
  trading (`postOrder`, `postOrders`, `cancelOrder`, `cancelOrders`, `cancelAll`,
  `cancelMarketOrders`, `getOrders`, `getOrder`, `getTrades`), rewards (public + authed),
  `sendHeartbeat`.
- `src/tools/polymarket/clob/client.ts:358` `getPolyClobClient()` — singleton factory,
  URL-invalidated (checks `config.json` `polymarket.clobBaseUrl` override).
- `src/tools/polymarket/clob/types.ts:28` `ClobOrder` — full order shape including `salt`
  and `signatureType` (0=EOA, 1=Poly Proxy, 2=Poly Gnosis Safe).
- `src/tools/polymarket/clob/types.ts:44` `SendOrderRequest` — wraps `order`, `owner`,
  `orderType` (GTC/FOK/GTD/FAK), optional `deferExec`.
- `src/tools/polymarket/clob/ws-market.ts:40` `PolyMarketStream` — public market WebSocket
  (`wss://ws-subscriptions-clob.polymarket.com/ws/market`). `EventEmitter`; emits `book`,
  `price_change`, `last_trade_price`, `tick_size_change`, `best_bid_ask`, `new_market`,
  `market_resolved`. Exponential backoff reconnect (1s base, 2x, 30s cap, 20% jitter).
  Ping every 10 s. No auth on subscription message.
- `src/tools/polymarket/clob/ws-user.ts:34` `PolyUserStream` — authenticated user
  WebSocket. `ClobAuthContext` (wallet address) passed at construction; credentials
  resolved via `requirePolyClobCredentials(address)` at `connect()` time and embedded
  in the subscription message (`auth: { apiKey, secret, passphrase }`). Emits `order`
  (PLACEMENT/UPDATE/CANCELLATION) and `trade` (MATCHED/MINED/CONFIRMED/FAILED). Same
  reconnect/ping pattern as `PolyMarketStream`.
- `src/tools/polymarket/clob/validation.ts` — Zod-free manual validators (runtime type
  checks) for every CLOB response shape.

### Gamma client (`gamma/`)

- `src/tools/polymarket/gamma/client.ts:29` `PolyGammaClient` — public-only Gamma discovery
  API. Methods: `listEvents`, `getEvent`, `getEventBySlug`, `getEventTags`, `listMarkets`,
  `getMarket`, `resolveMarket` (special: numeric ID → direct; `0x`-prefixed conditionId →
  `listMarkets({ condition_ids })` then fallback; other → direct), `getMarketBySlug`,
  `listTags`, `getTag`, `getTagBySlug`, `getRelatedTags`, `listSeries`, `getSeries`,
  `listComments`, `getComment`, `getCommentsByUser`, `getPublicProfile`,
  `getSportsMetadata`, `getSportsMarketTypes`, `listTeams`. URL-invalidated singleton.
- `src/tools/polymarket/gamma/types.ts` — `GammaEvent`, `GammaMarket`, `GammaTag`,
  `GammaRelatedTag`, `GammaSeries`, `GammaComment`, `GammaProfile`, `GammaSportsMetadata`,
  `GammaTeam`, `GammaSearchResult`, `ListEventsParams`, `ListMarketsParams`.

### Data client (`data/`)

- `src/tools/polymarket/data/client.ts:32` `PolyDataClient` — public-only user/market
  analytics. Methods: `getPositions`, `getClosedPositions`, `getActivity`, `getTrades`,
  `getValue`, `getTraded`, `getHolders`, `getOpenInterest`, `getLiveVolume`,
  `getMarketPositions`, `getLeaderboard`, `getBuilderLeaderboard`, `getBuilderVolume`,
  `getAccountingSnapshotUrl` (URL builder, no network). URL-invalidated singleton.
- `src/tools/polymarket/data/types.ts` — `DataPosition`, `DataClosedPosition`,
  `DataActivity`, `DataTrade`, `DataMetaHolder`, `DataOpenInterest`, `DataLiveVolume`,
  `DataLeaderboardEntry`, `DataBuilderEntry`, `DataBuilderVolumeEntry`,
  `DataMetaMarketPosition`, and params interfaces.

### Bridge client (`bridge/`)

- `src/tools/polymarket/bridge/client.ts:16` `PolyBridgeClient` — bridge deposit/withdraw
  address creation + cross-chain quote. Methods: `getSupportedAssets`, `createDeposit`,
  `createWithdraw`, `getQuote`, `getStatus`. All public (no auth). Simple singleton
  (no URL override from config).
- `src/tools/polymarket/bridge/types.ts` — `BridgeSupportedAsset`, `BridgeDepositResponse`
  (returns address object with optional `evm`/`svm`/`btc` fields — bridge creates a deposit
  address, does NOT submit a transaction directly), `BridgeQuoteRequest`, `BridgeQuoteResponse`,
  `BridgeTransaction` (status: DEPOSIT_DETECTED → PROCESSING → ORIGIN_TX_CONFIRMED →
  SUBMITTED → COMPLETED | FAILED).

### Relayer client (`relayer/`)

- `src/tools/polymarket/relayer/client.ts:15` `PolyRelayerClient` — gasless transaction
  submission. Methods: `submitTransaction` (POST `/submit` with `RelayerSubmitRequest`),
  `getTransaction`, `getTransactions`, `getNonce` (PROXY or SAFE type), `getRelayPayload`,
  `isDeployed`, `getApiKeys`. Auth headers passed externally (caller provides). Simple
  singleton.
- `src/tools/polymarket/relayer/types.ts` — `RelayerSubmitRequest` (EIP-712-style safe
  tx params), `RelayerSubmitResponse`, `RelayerTransaction` (STATE_NEW → STATE_EXECUTED
  → STATE_MINED → STATE_CONFIRMED | STATE_INVALID | STATE_FAILED), `RelayerApiKey`.

### EVM utilities

- `src/tools/polymarket/evm-utils.ts:53` `getPolygonClients(privateKey)` — creates
  viem `PublicClient` + `WalletClient` for Polygon, bound to `POLYGON_RPC` with
  30 s timeout and 2-retry transport. Used by the USDC.e approval flow.
- `src/tools/polymarket/evm-utils.ts:70` `validatePolySpender(address)` — whitelist
  check against `POLY_KNOWN_SPENDERS` (CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE only).
  Throws `INVALID_SPENDER` for any other address, preventing approval to unknown contracts.
- `src/tools/polymarket/evm-utils.ts:82` `approveUsdce(publicClient, walletClient, token, spender, requiredAmount, approveExact)` —
  reads current allowance; skips if `currentAllowance >= requiredAmount`; if partial
  (0 < current < required) issues a reset-to-zero first (USDT-style pattern); then
  approves `maxUint256` (or `requiredAmount` if `approveExact=true`) and awaits receipt.
  Returns `Hex | null` (null if no-op). Validates spender before any write.

## Key types & invariants

- `PolyClobCredentials` = `StoredPolyCredentials` (`auth.ts:75`) — `{ apiKey, apiSecret, passphrase }`. Canonical shape owned by `credential-map.ts`.
- `ClobAuthContext` (`clob/client.ts:39`) — `{ address: string }`. Passed per-call; client NEVER caches auth state on singleton instance (puzzle 5 phase 5D-protocols p3 invariant).
- `ClobOrder` (`clob/types.ts:28`) — `{ maker, signer, taker, tokenId, makerAmount, takerAmount, side, expiration, nonce, feeRateBps, signature, salt, signatureType }`. `signatureType` values: 0=EOA, 1=Poly Proxy, 2=Poly Gnosis Safe.
- `ORDER_TYPES` (`clob/signing.ts:30`) — 12-field EIP-712 typed struct for the CTF Exchange. Fields are `uint256` or `address` or `uint8`. `side` is encoded as numeric (0/1) before signing.
- **Fail-closed credential invariant**: `requirePolyClobCredentials` throws `POLYMARKET_NOT_CONFIGURED` for any address that is not in the per-wallet map AND is not the current primary with legacy fixed keys. A malformed map also throws. Never silently falls back to empty credentials.
- **No auth caching**: HMAC timestamp is computed fresh per call (`Math.floor(Date.now()/1000)`). Credentials are re-read from `process.env` on every authenticated request. This means a vault unlock (env injection) takes effect for the next call without any cache invalidation.
- **Spender whitelist**: `approveUsdce` calls `validatePolySpender` before issuing any `approve` transaction. Only `CTF_EXCHANGE` and `NEG_RISK_CTF_EXCHANGE` pass.
- **HMAC signs path only**: per Polymarket CLOB spec, the HMAC covers `timestamp + METHOD + path` (no query string). Query params are added to the URL separately.

## Capabilities (stable IDs)

- **CAP-polymarket-clob-sign-order**: EIP-712 CTF Exchange order signing via viem `signTypedData` — `clob/signing.ts:87 signClobOrder`
- **CAP-polymarket-clob-build-order**: unsigned order struct construction with random salt — `clob/signing.ts:50 buildClobOrder`
- **CAP-polymarket-clob-hmac-auth**: HMAC-SHA256 request auth (sign + header build) — `auth.ts:34 signClobRequest`, `auth.ts:53 buildClobHeaders`
- **CAP-polymarket-clob-cred-resolve**: per-wallet credential lookup with legacy primary fallback — `auth.ts:108 requirePolyClobCredentials`
- **CAP-polymarket-clob-post-order**: submit signed order to CLOB — `clob/client.ts:296 PolyClobClient.postOrder`
- **CAP-polymarket-clob-cancel**: cancel single/batch/all/market orders — `clob/client.ts:304 cancelOrder`, `cancelOrders`, `cancelAll`, `cancelMarketOrders`
- **CAP-polymarket-clob-orderbook**: public orderbook, price, midpoint, spread, tick, fee queries — `clob/client.ts:127 PolyClobClient.getOrderBook` and siblings
- **CAP-polymarket-clob-ws-market**: real-time public orderbook/price WebSocket — `clob/ws-market.ts:40 PolyMarketStream`
- **CAP-polymarket-clob-ws-user**: real-time authenticated order/trade WebSocket — `clob/ws-user.ts:34 PolyUserStream`
- **CAP-polymarket-bridge-deposit**: create a bridge deposit address (no direct on-chain tx) — `bridge/client.ts:63 PolyBridgeClient.createDeposit`
- **CAP-polymarket-bridge-quote**: cross-chain bridge quote — `bridge/client.ts:71 PolyBridgeClient.getQuote`
- **CAP-polymarket-bridge-status**: track bridge transaction status — `bridge/client.ts:74 PolyBridgeClient.getStatus`
- **CAP-polymarket-data-positions**: user open/closed positions query — `data/client.ts:79 PolyDataClient.getPositions`
- **CAP-polymarket-data-leaderboard**: leaderboard and builder stats — `data/client.ts:122 PolyDataClient.getLeaderboard`
- **CAP-polymarket-gamma-discover**: event/market/tag/search discovery — `gamma/client.ts:78 PolyGammaClient.listEvents`
- **CAP-polymarket-gamma-resolve**: conditionId → Gamma market resolution — `gamma/client.ts:110 PolyGammaClient.resolveMarket`
- **CAP-polymarket-relayer-submit**: gasless Polygon transaction via relayer — `relayer/client.ts:58 PolyRelayerClient.submitTransaction`
- **CAP-polymarket-evm-approve**: USDC.e ERC-20 approve for CTF Exchange with USDT-style reset — `evm-utils.ts:82 approveUsdce`
- **CAP-polymarket-evm-spender-validate**: whitelist check before any approve call — `evm-utils.ts:70 validatePolySpender`

## Public API (consumed by)

**Primary consumer — Z3 protocol handlers (vex-agent, `@tools/*` alias)**

- `src/vex-agent/tools/protocols/polymarket/handlers-clob.ts` → `getPolyClobClient`, `buildClobOrder`, `signClobOrder`, `requirePolyClobCredentials`, `getPolyGammaClient`, `USDC_E_DECIMALS`, `parseClobTokenIds`
- `src/vex-agent/tools/protocols/polymarket/handlers-bridge.ts` → `getPolyBridgeClient`
- `src/vex-agent/tools/protocols/polymarket/handlers-gamma.ts` → `getPolyGammaClient`
- `src/vex-agent/tools/protocols/polymarket/handlers-data.ts` → `getPolyDataClient`
- `src/vex-agent/tools/protocols/polymarket/handlers-rewards.ts` → `getPolyClobClient`

**Secondary consumers — vex-agent internals**

- `src/vex-agent/tools/internal/polymarket-setup.ts` → `hasPolyClobCredentials` (visibility gate — dynamic import)
- `src/vex-agent/sync/prediction-settlement-sync.ts` → `getPolyRelayerClient`, `getPolyDataClient` (dynamic imports for settlement)
- `src/vex-agent/sync/mtm.ts` → `getPolyClobClient` (dynamic import for MTM price fetch)

**vex-app main (`@vex-lib/polymarket.js` via `src/lib/polymarket.ts`)**

- `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` → re-export facade: `acquirePolymarketCredentialsWithPassword`, `buildPolymarketVaultUpdates`, `parseCredentialMapEnv`, env-key names
- `vex-app/src/main/secrets/session.ts` → same facade (reads credential map at unlock to log configured wallets)

**credential-map.ts re-export path**

- `src/lib/polymarket.ts:24` re-exports `buildPolymarketVaultUpdates`, `parseCredentialMapEnv`, `StoredPolyCredentials`, and the four env key name constants for use by vex-app main. The credential-map module is also imported directly by `src/tools/wallet/polymarket-credentials.ts` for the derivation/persistence path.

## Internal flow

### CLOB order placement (buy/sell call via protocol handler)

1. `handlers-clob.ts` (Z3) resolves session wallet address from `walletResolution.address`.
2. Calls `requirePolyClobCredentials(address)` → reads `parseCredentialMapEnv(process.env[...])` → returns `{ apiKey, apiSecret, passphrase }`.
3. Fetches market data from Gamma to resolve `conditionId` → `tokenId` via `parseClobTokenIds`.
4. Calls `buildClobOrder({ maker, signer, tokenId, makerAmount, takerAmount, side, feeRateBps })` → unsigned order with random salt.
5. Handler decrypts session wallet private key (via `walletResolution`; key never stored in this module).
6. Calls `signClobOrder(privateKey, order, negRisk)` → viem `signTypedData` with `CTF_EXCHANGE_DOMAIN` (or `NEG_RISK_CTF_EXCHANGE_DOMAIN` if `negRisk=true`) → `Hex` signature.
7. Builds `SendOrderRequest { order: { ...order, signature }, owner: address, orderType }`.
8. Calls `getPolyClobClient().postOrder({ address }, sendOrderRequest)` → `requestAuth` computes HMAC (timestamp + POST + /order + body), builds 5 headers, POSTs to `clob.polymarket.com/order`.
9. Response validated by `validateSendOrderResponse` → `SendOrderResponse { success, orderID, status }`.

### CLOB HMAC signing detail

```
timestamp  = Math.floor(Date.now() / 1000).toString()
message    = timestamp + METHOD.toUpperCase() + path + body   (body="" for GETs)
signature  = HMAC-SHA256(message, apiSecret).digest("base64")
Headers:
  POLY_API_KEY    = apiKey
  POLY_ADDRESS    = normalized EVM address
  POLY_SIGNATURE  = base64 HMAC
  POLY_PASSPHRASE = passphrase
  POLY_TIMESTAMP  = timestamp
```

### EIP-712 CTF Exchange signing (order)

```
Domain:
  name:              "Polymarket CTF Exchange"
  version:           "1"
  chainId:           137  (Polygon)
  verifyingContract: CTF_EXCHANGE | NEG_RISK_CTF_EXCHANGE

Types.Order (12 fields, all uint256 / address / uint8):
  salt, maker, signer, taker, tokenId, makerAmount, takerAmount,
  expiration, nonce, feeRateBps, side, signatureType

Encoding:
  side = "BUY" → 0 (uint8)  /  "SELL" → 1
  All numeric fields passed as BigInt to viem
```

### Credential resolution flow (at authenticated request time)

```
requirePolyClobCredentials(address):
  normalized = getAddress(address).toLowerCase()
  map        = parseCredentialMapEnv(process.env[POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS])
  if map[normalized]  → return those creds
  if address == getPrimaryEvmAddress() AND all three fixed env keys present
                      → return legacy fixed creds (pre-B primary-only)
  else                → throw POLYMARKET_NOT_CONFIGURED
```

### Bridge deposit flow

1. `handlers-bridge.ts` (Z3) calls `getPolyBridgeClient().createDeposit(address)` → POST `bridge.polymarket.com/deposit { address }`.
2. Returns `BridgeDepositResponse.address.evm` (a Polygon address to send USDC.e to).
3. **No transaction is signed by this module** — the bridge deposit address is returned to the agent, which presents it to the user; the actual USDC.e transfer is executed separately. The bridge monitors the deposit address and processes the cross-chain transfer.
4. Status polled via `getStatus(address)` → array of `BridgeTransaction` with lifecycle `DEPOSIT_DETECTED → PROCESSING → COMPLETED`.

## Dependencies

- **Imports FROM**:
  - `src/config/store.ts` (`loadConfig`) — reads `polymarket.*BaseUrl` overrides
  - `src/utils/http.ts` (`fetchWithTimeout`, `readJson`) — all HTTP requests
  - `src/utils/validation-helpers.ts` (`isRecord`) — response shape guards
  - `src/utils/logger.ts` — winston structured logging
  - `src/errors.ts` (`VexError`, `ErrorCodes`) — error construction
  - `src/tools/wallet/inventory.ts` (`getPrimaryEvmAddress`) — legacy primary-wallet fallback in auth.ts only
  - `viem` (`createPublicClient`, `createWalletClient`, `signTypedData`, `writeContract`, `readContract`, etc.) — EIP-712 signing + ERC-20 approve
  - `viem/accounts` (`privateKeyToAccount`) — wallet client construction in signing.ts and evm-utils.ts
  - `node:crypto` (`createHmac`) — HMAC-SHA256 in auth.ts
  - `node:events` (`EventEmitter`) — WebSocket streams

- **Consumed BY** (Z3 and Z5):
  - `src/vex-agent/tools/protocols/polymarket/handlers-*.ts` — primary runtime consumers
  - `src/vex-agent/tools/internal/polymarket-setup.ts` — credential check gate
  - `src/vex-agent/sync/prediction-settlement-sync.ts`, `mtm.ts` — settlement/MTM price
  - `src/tools/wallet/polymarket-credentials.ts` — imports `credential-map.ts` + `constants.ts` for the derivation/persistence path (out of scope)
  - `src/lib/polymarket.ts` — re-export facade for `@vex-lib/polymarket.js`
  - `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` and `secrets/session.ts` via `@vex-lib/polymarket.js`

## Cross-references

- Protocol-layer usage: `module.vex-agent.tools-protocols` — `CAP-protocol-polymarket-clob-order`, `CAP-protocol-polymarket-bridge`, `CAP-protocol-polymarket-data-*`, `CAP-protocol-polymarket-gamma-*`
- Credential derivation (out of scope): `src/tools/wallet/polymarket-credentials.ts` — EIP-712 ClobAuth L1 sign → POST `/auth/derive-api-key` or `/auth/api-key` → persist to vault via `buildPolymarketVaultUpdates`
- Vault injection: `vex-app/src/main/secrets/session.ts:applyUnlockedRuntime` — injects all five env keys at unlock; this module reads them on every authenticated call
- Env key NAMES: `module.src-root.lib-vault-secrets` — owns `VAULT_SECRET_KEYS`, which includes `POLYMARKET_CLOB_CREDENTIALS_BY_ADDRESS`
- vex-app coverage: `audits/current/coverage-gaps.md#CAP-polymarket-*`
- quality findings: `audits/current/quality-findings.md#FINDING-*`

## Refresh triggers

- Any change to `src/tools/polymarket/**` (new client method, signing change, credential resolution logic change)
- `src/lib/polymarket.ts` re-export changes
- `src/tools/wallet/polymarket-credentials.ts` (EIP-712 ClobAuth domain/types changes may affect how L1 auth works at derivation time, not order signing)
- `vex-app/src/main/secrets/session.ts` (vault unlock → env injection path changes)

## Open questions

1. **`signClobOrder` accepts raw private key** (`Hex`) from the calling handler. This means the protocol handler must extract the private key from the session wallet. The signing happens synchronously in this module, then the key should be discarded. No explicit zeroing of the key material is done by this module. The caller's responsibility for key lifetime is implicit. Worth documenting in the handler or adding a comment here.
2. **Singleton auth context leak**: `PolyUserStream` stores `ClobAuthContext` at construction (and re-reads `requirePolyClobCredentials` at each `connect()`), but `PolyMarketStream` is purely public. If an agent session ends while a stream is connected, no automatic `disconnect()` is called — the caller must manage stream lifetime. No cleanup path is currently verified in the protocol handlers.
3. **`getPolyBridgeClient()` singleton is NOT URL-invalidated** (unlike `PolyClobClient` and `PolyGammaClient`). A `config.json` change to `polymarket.bridgeBaseUrl` at runtime would not take effect. `PolyRelayerClient` has the same issue.
4. **`approveUsdce` USDT-style reset**: the reset-to-zero-then-approve path is correct for tokens like USDT (which requires zero allowance before re-approving), but the code comment says "USDT-style reset" even though the token is `USDC.e`. USDC.e does not require a zero reset. The code is safe but slightly over-cautious; this is a cosmetic issue.
5. **`PolyMarketStream` uses the global `WebSocket`**: relies on Node.js ≥21 native `WebSocket` or a global polyfill. If the Electron Node version does not expose `WebSocket` globally, the market stream will fail at runtime with a `ReferenceError`. Verified indirectly from Electron 42 shipping Node 22; should be safe but not explicitly tested.
