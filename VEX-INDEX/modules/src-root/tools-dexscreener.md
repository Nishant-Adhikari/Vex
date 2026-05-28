---
id: module.src-root.tools-dexscreener
kind: module
paths:
  - "src/tools/dexscreener/**"
source_commit: 152af27
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/tools/dexscreener/**"
  - "src/config/store.ts"
  - "src/utils/http.ts"
  - "src/errors.ts"
  - "src/vex-agent/tools/protocols/dexscreener/**"
related:
  - module.vex-agent.tools-protocols
  - module.src-root.lib-db-utilities
---

# module.src-root.tools-dexscreener — DexScreener REST + WebSocket Client

## Purpose

Provides a typed REST client and a WebSocket streaming client for the public
DexScreener API (`https://api.dexscreener.com`). Covers 10 REST endpoints and
5 real-time WebSocket channels for multi-chain DEX pair data, token profiles,
boost/promotion signals, community takeovers, ads, and paid-order verification.
All operations are **read-only** — no API key, no wallet, no signing surface.
This module is the Z5 network client; the engine-side protocol wrapper lives
in `src/vex-agent/tools/protocols/dexscreener/` (see `module.vex-agent.tools-protocols`).

## Retrieval keywords

- dexscreener, DEX pair, token price, liquidity, volume, FDV, market cap
- token profile, boosts, community takeover, CTO, trending, ads, orders
- WebSocket stream, real-time feed, profiles channel, boosts-top
- DexScreenerClient, getDexScreenerClient, DexScreenerStream
- read-only protocol, no API key, multi-chain DEX analytics

## State owned

- **No DB tables** — purely a network client; no local persistence.
- **Module-level singleton** (`client.ts:149–161`): `cachedClient`/`cachedBaseUrl` —
  lazily constructed from `loadConfig().services.dexScreenerApiUrl`; invalidated when
  base URL changes. Not thread-safe in edge cases but acceptable for single-process use.
- **No env vars** — base URL sourced from `config.json` via `loadConfig()`;
  default is `"https://api.dexscreener.com"` (`config/store.ts:125`).

## Boundary crossings

| Direction | Boundary |
|-----------|----------|
| Network (outbound) | HTTP GET via `fetchWithTimeout` (30 s default timeout, `AbortController`-backed) to `dexScreenerApiUrl` — no auth header |
| Network (outbound) | WebSocket connection (`DexScreenerStream`) to `dexScreenerApiUrl` with `http` → `ws` scheme substitution |
| Config read | `loadConfig()` → `config.json` → `services.dexScreenerApiUrl` (config/store.ts:74,125) |
| Error types | Throws typed `VexError` with `DEXSCREENER_*` error codes — passes through `mapTransportError` which re-wraps `HTTP_TIMEOUT` / `HTTP_REQUEST_FAILED` from `utils/http.ts` |
| No DB, no wallet, no signing, no IPC | Confirmed read-only boundary — no `process.env` secrets consumed |

## File map

- `src/tools/dexscreener/types.ts:1` — all TypeScript interfaces mirroring the
  DexScreener OpenAPI spec: `DexPair`, `DexToken`, `DexQuoteToken`, `DexLiquidity`,
  `DexPairInfo`, `DexBoosts`, `PairsResponse`, `SearchResponse`, `TokensResponse`,
  `TokensPairsResponse`, `DexTokenProfile`, `DexBoost`, `DexOrder`, `DexOrderType`,
  `DexOrderStatus`, `DexCommunityTakeover`, `DexAd`, `DexTrendingItem`, `WsHandshake<T>`,
  `DexStreamChannel` (union of 5 channel names). No Zod schemas — validation is
  hand-written in `validation.ts` following the repo's Khalani pattern.

- `src/tools/dexscreener/validation.ts:1` — hand-written runtime validators. Every
  exported function accepts `unknown` and either returns the typed value or throws
  `VexError(DEXSCREENER_INVALID_RESPONSE)`. Key exports: `validatePairsResponse`,
  `validateSearchResponse`, `validateTokensResponse`, `validateTokensPairsResponse`,
  `validateProfilesResponse`, `validateBoostsResponse`, `validateOrdersResponse`,
  `validateCommunityTakeoversResponse`, `validateAdsResponse`, `validateWsHandshake<T>`,
  `validateWsProfile`, `validateWsBoost`, `validateWsCommunityTakeover`, `validateWsAd`.
  Internal helper `parsePair` handles the full nested `DexPair` shape including
  `txns`, `volume`, `priceChange`, `liquidity`, `info`, `boosts`, `labels` — each
  tolerant-parses unknown sub-fields rather than hard-failing.

- `src/tools/dexscreener/errors.ts:1` — HTTP status → `VexError` mapping.
  `mapDexScreenerError(status, message?)`: 429 → `DEXSCREENER_RATE_LIMITED` (retryable),
  404 → `DEXSCREENER_NOT_FOUND`, 5xx → `DEXSCREENER_API_ERROR` (retryable), else
  `DEXSCREENER_API_ERROR`. `mapTransportError(err)`: re-wraps `HTTP_TIMEOUT` →
  `DEXSCREENER_TIMEOUT`, `HTTP_REQUEST_FAILED` → `DEXSCREENER_API_ERROR`; pass-through
  for already-typed `DEXSCREENER_*` errors; rethrows unknown errors as-is.

- `src/tools/dexscreener/client.ts:36` `DexScreenerClient` — REST client class.
  Private `request<T>(path, validator, query?)` method handles URL construction,
  `fetchWithTimeout` call, non-OK response mapping, and validator invocation.
  - `client.ts:152` `getDexScreenerClient()` — singleton factory; reconstructs instance
    if `dexScreenerApiUrl` changes; exports as the primary entry point for consumers.

- `src/tools/dexscreener/ws-client.ts:42` `DexScreenerStream` — `EventEmitter`-based
  WebSocket client. Uses native Node 22+ `WebSocket` (no external dependency).
  Reconnect: exponential backoff 1 s → 30 s, `×2` multiplier, `±20%` jitter.
  Lifecycle managed via `connect()` / `disconnect()`; `destroyed` flag prevents
  reconnect after `disconnect()`.

## Key types & invariants

- `DexPair` (`types.ts:43`) — core schema; fields like `priceUsd`, `liquidity.usd`,
  `fdv`, `marketCap`, `pairCreatedAt`, `priceChange` are explicitly nullable
  (`| null`), faithfully following the API spec.
- `DexStreamChannel` (`types.ts:170`) — `"profiles" | "boosts" | "boosts-top" |
  "community-takeovers" | "ads"` — closed union; `CHANNEL_PATHS` in `ws-client.ts:14`
  maps each to its WS path; compile-time exhaustive.
- `WsHandshake<T>` (`types.ts:165`) — first WebSocket message; `{limit: number, data: T[]}`.
  `DexScreenerStream` discriminates first vs. subsequent messages via
  `handshakeReceived` flag; first → `"handshake"` event, rest → `"update"` events.
- `mapTransportError` (`errors.ts:31`) — `never` return type; always throws; catches
  both VexError subtypes and raw unknowns. Called in `client.ts:69` catch clause.
- **No `DexOrderType`/`DexOrderStatus` runtime validation** — `validation.ts:272–276`
  casts these with `as`, trusting the API to return valid enum members. Acceptable
  risk given read-only + no signing surface.

## Capabilities (stable IDs)

- **CAP-dexscreener-search**: cross-chain pair search by name/symbol/address —
  `client.ts:77 DexScreenerClient.search`
- **CAP-dexscreener-getPairs**: pair details by chain + pair address —
  `client.ts:82 DexScreenerClient.getPairs`
- **CAP-dexscreener-getTokens**: batch token data (up to 30 comma-separated addresses) —
  `client.ts:90 DexScreenerClient.getTokens`
- **CAP-dexscreener-getTokenPairs**: all DEX pools for a single token —
  `client.ts:98 DexScreenerClient.getTokenPairs`
- **CAP-dexscreener-getProfiles**: latest trending token profiles —
  `client.ts:108 DexScreenerClient.getProfiles`
- **CAP-dexscreener-getBoosts**: latest boosted tokens —
  `client.ts:113 DexScreenerClient.getBoosts`
- **CAP-dexscreener-getTopBoosts**: top-ranked boosted tokens —
  `client.ts:118 DexScreenerClient.getTopBoosts`
- **CAP-dexscreener-getCommunityTakeovers**: latest community takeover events —
  `client.ts:125 DexScreenerClient.getCommunityTakeovers`
- **CAP-dexscreener-getAds**: latest ads —
  `client.ts:131 DexScreenerClient.getAds`
- **CAP-dexscreener-getOrders**: paid promotional orders for a specific token —
  `client.ts:137 DexScreenerClient.getOrders`
- **CAP-dexscreener-stream**: real-time WebSocket feed on one of 5 channels —
  `ws-client.ts:42 DexScreenerStream`

## Public API (consumed by)

- `src/vex-agent/tools/protocols/dexscreener/handlers.ts:8` — imports
  `getDexScreenerClient` via `@tools/dexscreener/client.js`; all 11 agent-facing
  tool handlers call the singleton client (see `module.vex-agent.tools-protocols`,
  CAP-protocol-dexscreener-research).
- `src/vex-agent/tools/protocols/dexscreener/handlers.ts:9` — imports
  `DexBoost`, `DexTokenProfile`, `DexTrendingItem` types from `@tools/dexscreener/types.js`
  for the in-handler `dexscreener.trending` merge logic.
- `DexScreenerStream` (`ws-client.ts`) — not currently imported by any engine or
  vex-app path; available for future real-time agent capabilities or CLI `stream` command
  (`src/commands/dexscreener/stream.ts`, out-of-scope for this module).
- **No vex-app/src consumers** — consistent with Z5 boundary; vex-app reaches
  DexScreener data only through the engine IPC chain.

## Internal flow

### REST request (all 10 endpoints)

1. Caller (engine protocol handler) calls `getDexScreenerClient()` → singleton
   `DexScreenerClient` constructed from `config.json` `dexScreenerApiUrl`.
2. `client.request<T>(path, validator, query?)`:
   - `buildUrl(path, query)` constructs full URL with `URL` constructor + `searchParams`.
   - `fetchWithTimeout(url)` issues GET with 30 s AbortController timeout
     (`utils/http.ts:16`).
   - Non-OK response: `readJson(response)` → `mapDexScreenerError(status, message)` →
     throws `VexError`.
   - OK response: `readJson(response)` → `validator(raw)` → typed result or throws
     `VexError(DEXSCREENER_INVALID_RESPONSE)`.
   - Catch clause: `mapTransportError(err)` — re-wraps transport errors, rethrows
     already-typed `DEXSCREENER_*` errors unchanged, rethrows unknowns as-is.

### WebSocket lifecycle (`DexScreenerStream`)

1. Caller constructs `new DexScreenerStream({ channel })` — `wsUrl` derived from
   `dexScreenerApiUrl` with `http` → `ws` scheme substitution.
2. `connect()` — idempotent guard (`if (this.ws) return`); creates `new WebSocket(wsUrl)`;
   sets `handshakeReceived = false`.
3. `open` event → resets `reconnectAttempt = 0`; emits `"connected"`.
4. `message` event → JSON.parse; if `!handshakeReceived`: set flag + emit `"handshake"`;
   else emit `"update"`. Parse failures → `logger.warn`, silently dropped (no throw).
5. `close` event → `this.ws = null`; emits `"disconnected"`; unless `destroyed`,
   calls `scheduleReconnect()`.
6. `scheduleReconnect()` — computes `baseDelay = min(1000 × 2^attempt, 30000)` with
   `±20%` jitter; schedules `setTimeout` → `connect()`. Increments `reconnectAttempt`.
7. `disconnect()` — sets `destroyed = true`; clears pending timer; closes `ws`; sets
   `ws = null`. Prevents all further reconnects.

**Perf-cleanup concern**: `DexScreenerStream` instances are not pooled or tracked by any
registry. Callers are responsible for calling `disconnect()` before release. An unreferenced
stream with a live WebSocket will keep the event loop alive and attempt reconnects
indefinitely if the `close` event fires before `disconnect()` is called. No current
production callsite instantiates a persistent stream (CLI use only at present), so this
is a latent risk rather than an active bug.

### dexscreener.trending (composite handler)

The `dexscreener.trending` protocol handler (`protocols/dexscreener/handlers.ts:76`)
merges two REST calls in parallel:

1. `Promise.all([client.getProfiles(), client.getBoosts()])` — parallel fetch.
2. Seed map from `boosts` keyed by `chainId:tokenAddress`; `boostAmount`/`boostTotalAmount`
   set from `boost.amount`/`totalAmount`.
3. Walk `profiles`: if key exists, set `hasProfile=true` + fill nulls for `icon`,
   `description`, `links`. If key absent, insert with `boostAmount/boostTotalAmount=0`.
4. Sort: `boostTotalAmount` desc, then `hasProfile` presence (profile-holders first at
   tie). Optional `limit` slice.

## Dependencies

- **Imports FROM**:
  - `src/config/store.ts` (`loadConfig`) — reads `dexScreenerApiUrl` for base URL
  - `src/utils/http.ts` (`fetchWithTimeout`, `readJson`) — HTTP transport with timeout
  - `src/errors.ts` (`VexError`, `ErrorCodes`) — typed error construction
  - `src/utils/validation-helpers.ts` (`isRecord`) — `unknown`-safe object guard
  - `node:events` (`EventEmitter`) — WS client base class
  - `src/utils/logger.ts` (winston) — debug/info/warn/error logs in WS client
- **Consumed BY**:
  - `src/vex-agent/tools/protocols/dexscreener/handlers.ts` (Z3, via `@tools/*` alias)
    — sole engine consumer; all 11 dexscreener protocol tool handlers
  - `src/commands/dexscreener/` (CLI commands, out of Z5 scope; not engine-path)

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-protocol-dexscreener-research`
- quality findings: `audits/current/quality-findings.md#FINDING-*`
- related modules: `module.vex-agent.tools-protocols` (engine wrapper + manifest/discovery)
- engine handler layer: `src/vex-agent/tools/protocols/dexscreener/handlers.ts` (Z3)

## Refresh triggers

Stale if any file under `src/tools/dexscreener/` changes (new endpoint, type change,
validation update, WS channel addition). Also stale if `src/config/store.ts` changes
the `dexScreenerApiUrl` key or default, or if `src/utils/http.ts` changes the
`fetchWithTimeout` timeout default or signature.

## Open questions

1. **WebSocket not used in any production path**: `DexScreenerStream` has no callsite
   in `src/vex-agent/` or `vex-app/src/`. It is only exercised by the CLI `stream`
   command. If real-time CTO signals are ever wired into agent tools, a persistent-stream
   lifecycle pattern (owner tracking, guaranteed `disconnect()` on session end) will be
   needed — without it the EventEmitter leak pattern in #5 above becomes a real bug.
2. **`DexOrderType`/`DexOrderStatus` cast** (`validation.ts:272–276`): these string
   fields are cast with `as` without exhaustive checking. If the API adds new enum
   members, the TypeScript union types become stale silently. Low risk given read-only
   use, but worth a comment or a guard.
3. **`dexscreener.trending` partial failure**: if one of `getProfiles()` or `getBoosts()`
   rejects, `Promise.all` rejects the whole handler — no partial fallback. Acceptable
   given read-only context (caller gets an error vs. a stale partial result).
4. **Rate limit split not enforced in client**: search/pairs/tokens endpoints allow
   300 req/min; all others 60 req/min. The client has no per-endpoint rate limiting —
   `retryable:true` on 429 is the only mitigation. If an agent hammers profiles/boosts,
   it will hit 429 without back-pressure.
