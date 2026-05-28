---
id: module.src-root.tools-solana-jupiter-twitter
kind: module
paths:
  - "src/tools/solana-ecosystem/jupiter/**"
  - "src/tools/solana-ecosystem/shared/**"
  - "src/tools/twitter-account/**"
source_commit: 152af27
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/tools/solana-ecosystem/jupiter/**"
  - "src/tools/solana-ecosystem/shared/**"
  - "src/tools/twitter-account/**"
  - "src/vex-agent/tools/protocols/solana-jupiter/**"
  - "src/vex-agent/tools/internal/twitter-account.ts"
  - "src/vex-agent/tools/registry/twitter-account.ts"
related:
  - module.vex-agent.tools-protocols
  - module.vex-agent.tools-internal
  - module.src-root.lib-wallet
  - module.src-root.lib-db-utilities
---

# module.src-root.tools-solana-jupiter-twitter — Solana/Jupiter Client Library + Twitter Read Client

## Purpose

Two independent client libraries consumed exclusively by the vex-agent protocol and tool layers (Z3). The
Solana/Jupiter section provides the complete HTTP client + service stack for five Jupiter API surfaces:
swaps (v2, mutating), prices (v3, read-only), tokens (v2, read-only), lending (earn REST, mutating), and
predictions (REST, mutating and read). The `shared/` sub-folder owns all cross-cutting Solana primitives
(connection, tx signing/sending, transfers, burn, close-account, token-cache, address validation, swap
classification, auth helpers, constants). The Twitter section provides a thin, Zod-validated, completely
read-only Rettiwt wrapper exposing 13 action variants.

## Retrieval keywords

- Jupiter swap execute, Jupiter swap quote, solana.swap.execute, solana.swap.quote
- Jupiter Prices v3, solana.prices, getJupiterPricesByMint
- Jupiter Tokens v2, solana.tokens.search, solana.tokens.trending, requireJupiterResolvedToken
- Jupiter Lend Earn, solana.lend.rates, solana.lend.deposit, solana.lend.withdraw, lend earn API
- Jupiter Prediction, solana.predict.buy, solana.predict.sell, solana.predict.claim, solana.predict.closeAll
- Rettiwt, twitter_account, tweet_search, user_timeline
- Solana connection singleton, getSolanaConnection, signAndSendVersionedTx, signAndSendLegacyTx
- solana token cache, SOLANA_TOKEN_CACHE_FILE, well-known tokens, SOL_MINT
- swap classification, classifySolanaSwap, tradeSide, instrumentMint
- Jupiter API key, JUPITER_API_KEY, requireJupiterApiKey
- RETTIWT_API_KEY, sanitizeTwitterAccountError

## State owned

- **`${CONFIG_DIR}/solana-token-cache.json`** (filesystem): file-based token-metadata cache, 24h TTL,
  atomic write-via-rename. Keyed by mint address; symbol lookup by linear scan. Written by
  `shared/solana-token-cache.ts:cacheSolanaTokens`. Read by `jupiter-tokens/service.ts:resolveJupiterToken`.
- **Connection singleton** (`shared/solana-transaction.ts:connectionInstance`): module-level
  `Connection | null`. Reset-able via `resetSolanaConnection()`. Seeded from `config.json` on first call to
  `getSolanaConnection()`.
- **No DB state** — this module writes nothing to Postgres. All DB persistence is handled upstream by
  `vex-agent/tools/protocols/runtime.ts:captureExecution`.

## Boundary crossings

| Direction | Boundary |
|-----------|----------|
| Outbound — Solana RPC | `shared/solana-transaction.ts:getSolanaConnection()` → `config.json:solana.rpcUrl` (configured at onboarding) |
| Outbound — Jupiter Swap v2 | `https://api.jup.ag/swap/v2/{order,build,execute}` — `x-api-key: JUPITER_API_KEY` (vault secret) |
| Outbound — Jupiter Prices v3 | `https://api.jup.ag/price/v3?ids=…` — `x-api-key: JUPITER_API_KEY` |
| Outbound — Jupiter Tokens v2 | `https://api.jup.ag/tokens/v2/{search,tag,recent,…}` — `x-api-key: JUPITER_API_KEY` |
| Outbound — Jupiter Lend Earn | `https://api.jup.ag/lend/v1/earn/{tokens,positions,earnings,deposit,withdraw,mint,redeem,…}` — `x-api-key: JUPITER_API_KEY` |
| Outbound — Jupiter Prediction v1 | `https://api.jup.ag/prediction/v1/…` — `x-api-key: JUPITER_API_KEY` |
| Outbound — Twitter/X via Rettiwt | `rettiwt-api` NPM SDK; cookie-based auth from `RETTIWT_API_KEY` env var (vault secret) |
| Filesystem | `solana-token-cache.ts` reads/writes `SOLANA_TOKEN_CACHE_FILE` in `${CONFIG_DIR}` |
| Signing (Solana) | Accepts raw `Uint8Array` secret keys at service layer; `Keypair.fromSecretKey` inline; no key storage |
| Env | `process.env.JUPITER_API_KEY`, `process.env.RETTIWT_API_KEY` (both injected by `secrets/session.ts:applyUnlockedRuntime` after vault unlock) |

## File map

### shared/ (cross-protocol Solana primitives)

- `shared/types.ts:1` — `TokenMetadata`, `TransferResult`, `SolanaInstructionAccountMeta`, `SolanaInstructionWire`
- `shared/solana-constants.ts:7` — `SOL_MINT`, `SOL_DECIMALS`, `SPL_TOKEN_PROGRAM_ID`,
  `WELL_KNOWN_SOLANA_TOKENS` (15 entries), `getWellKnownSolanaTokenBySymbol`, `getWellKnownSolanaTokenByMint`
- `shared/solana-validation.ts:9` — `validateSolanaAddress` (base58, throws `VexError.SOLANA_INVALID_ADDRESS`),
  `tokenAmountToUi`, `uiToTokenAmount`, `parseSolAmount`, `parseSplAmount`, `lamportsToSol`,
  `shortenSolanaAddress`, `solanaExplorerUrl` (reads `config.json:solana.{explorerUrl,cluster}`)
- `shared/solana-transaction.ts:16` — Versioned tx primitives:
  - `deserializeVersionedTx` — base64 or bytes → `VersionedTransaction`
  - `signVersionedTx` — wraps `tx.sign(signers)` with `VexError.SOLANA_TX_FAILED`
  - `sendSignedVersionedTx` — `sendRawTransaction` + `confirmVersionedTx` (poll loop, 60s timeout, retryable flag)
  - `signAndSendVersionedTx` — compose + network-retry (3 attempts, retryable only)
  - `confirmVersionedTx` — 2s poll, throws `SOLANA_TX_FAILED` (chain error) or `SOLANA_TX_TIMEOUT`
  - `getSolanaConnection` / `resetSolanaConnection` — module-level singleton
  - `signAndSendLegacyTx` — legacy `Transaction` helper (Jupiter swaps + transfers), throws on any error
  - `signAndSubmitLegacyTxStaged` (`:249`) — staged variant for `wallet_send_confirm`; always returns
    `{signature, phase}` after broadcast; pre-broadcast throws; phase = `confirmed | chain_failed | confirmation_unknown`
- `shared/solana-transfer.ts:30` — `sendSol` (SOL native transfer, balance check), `sendSplToken`
  (SPL TransferChecked with ATA create-or-get)
- `shared/solana-account.ts:18` — `burnSplToken` (full-balance or partial, single mint), `closeEmptyAccounts`
  (batch SPL close ≤10/tx, rent reclaim)
- `shared/solana-token-cache.ts:62` — `getCachedSolanaToken` (by mint or symbol, 24h TTL),
  `cacheSolanaTokens` (upsert by mint address, atomic rename write)
- `shared/jupiter-auth.ts:12` — `resolveJupiterApiKey` (`process.env.JUPITER_API_KEY?.trim() || ""`),
  `requireJupiterApiKey` (throws `VexError` if missing), `getJupiterHeaders`
- `shared/swap-classify.ts:39` — `classifySolanaSwap(inputMint, outputMint): SwapClassification`
  (`tradeSide: "buy"|"sell"|null`, `instrumentMint: string`, `meta: {stableSwap?,ambiguousSwap?}`)
  — pure function; canonical quote set: SOL + USDC + USDT

### jupiter/jupiter-swaps/ (Jupiter Swap API v2)

- `jupiter-swaps/types.ts:12` — `JUPITER_SWAP_V2_BASE_URL = "https://api.jup.ag/swap/v2"`,
  `JupiterSwapOrderParams`, `JupiterSwapOrderResponse`, `JupiterSwapBuildParams`, `JupiterSwapBuildResponse`,
  `JupiterSwapExecuteRequest`, `JupiterSwapExecuteResponse`, `JupiterSwapQuoteSummary`,
  `JupiterSwapBuildSummary`, `JupiterSwapExecutionResult`
- `jupiter-swaps/validation.ts:95` — `requireJupiterApiKey` (wraps shared; feature = "Jupiter Swap API V2",
  errorCode = `SOLANA_SWAP_FAILED`), `getJupiterSwapHeaders`, param validators,
  `normalizeOrderQueryParams` / `normalizeBuildQueryParams` (validate + build clean `Record<string,string>`)
- `jupiter-swaps/client.ts:27` — `jupiterSwapOrder` (GET `/order`), `jupiterSwapBuild` (GET `/build`),
  `jupiterSwapExecute` (POST `/execute`)
- `jupiter-swaps/service.ts:112` — **Public API:**
  - `getJupiterSwapQuote(inputSymbolOrMint, outputSymbolOrMint, uiAmount, opts): {quote, raw}`
    — resolves tokens → atomic → `/order`; throws `SOLANA_QUOTE_FAILED` on error code
  - `buildSwapTransaction(…, opts: JupiterSwapBuildOptions): {build, raw}`
    — resolves tokens → atomic → `/build`
  - `executeJupiterSwap(inputSOM, outputSOM, uiAmount, secretKey, opts): JupiterSwapExecutionResult`
    — resolves tokens → `/order` → deserialize → sign → `/execute`; throws `SOLANA_SWAP_FAILED` on failure
    or `SIGNER_MISMATCH` if explicit taker differs from derived keypair address
  - Aliases: `getSwapQuote`, `getSwapBuild`, `executeSwap`

### jupiter/jupiter-prices/ (Jupiter Price API v3)

- `jupiter-prices/types.ts` — `JUPITER_PRICE_V3_BASE_URL = "https://api.jup.ag"`,
  `JupiterPriceRequestParams`, `JupiterPriceResponse` (mint → price map), `JupiterSinglePriceResult`,
  `JupiterResolvedPriceResult`, `JupiterResolvedPriceBatch`
- `jupiter-prices/client.ts:19` — `jupiterPrices(params)`, `jupiterPricesByMint(mints[])`
  — both hit `GET /price/v3?ids=…`; require `JUPITER_API_KEY`
- `jupiter-prices/service.ts:45` — `getJupiterPrices`, `getJupiterPricesByMint`,
  `getJupiterPriceByMint(mint): JupiterSinglePriceResult`,
  `getJupiterPriceForTokenQuery(query): JupiterResolvedPriceResult & {raw}` (resolves token first),
  `getJupiterPricesForTokenQueries(queries[]): JupiterResolvedPriceBatch`

### jupiter/jupiter-tokens/ (Jupiter Token API v2)

- `jupiter-tokens/types.ts:8` — `JUPITER_TOKENS_V2_BASE_URL = "https://api.jup.ag/tokens/v2"`,
  `JupiterTokenTag`, `JupiterTokenCategory`, `JupiterTokenInterval`, `JupiterMintInformation`,
  `JupiterResolvedToken`, `JupiterTokenSearchParams`, `JupiterTokenCategoryParams`
- `jupiter-tokens/client.ts:14` — `jupiterTokenSearch`, `jupiterTokensByMint`, `jupiterTokensByTag`,
  `jupiterTokensByCategory`, `jupiterRecentTokens` — all require `JUPITER_API_KEY`
- `jupiter-tokens/service.ts:67` — **Cross-protocol token resolution hub:**
  - `resolveJupiterToken(query): TokenMetadata | undefined` — lookup order: well-known map → file cache
    → API (by mint or search); caches result; symbol vs mint routed by `looksLikeMintQuery`
  - `resolveJupiterTokens(queries[]): Map<string, TokenMetadata>` — batch; well-known + cache first,
    then parallel mint lookup + sequential symbol search for misses
  - `requireJupiterResolvedToken(query): TokenMetadata` — throws `SOLANA_TOKEN_NOT_FOUND` if not found
  - `searchJupiterTokens`, `getJupiterTokensByMint`, `getJupiterTokensByTag`,
    `getJupiterTokensByCategory`, `getJupiterRecentTokens` — thin wrappers
- `jupiter-tokens/content/` — separate `JupiterTokenContentApi` sub-module for token content/metadata
  enrichment (client, service, types, validation)

### jupiter/jupiter-lend/ (Jupiter Lend Earn REST)

- `jupiter-lend/constants.ts:6` — `JUPITER_LEND_API_BASE_URL = "https://api.jup.ag/lend/v1"`,
  `JUPITER_LEND_EARN_API_BASE_URL = "${BASE}/earn"`, `JUPITER_LEND_PROGRAM_ADDRESSES` (6 on-chain),
  `JUPITER_LEND_DEFERRED_AREAS` (borrow SDK, flashloan, etc. not yet implemented)
- `jupiter-lend/earn-api/types.ts` — `JupiterLendEarnAmountRequest` (`{asset, signer, amount}`),
  `JupiterLendEarnSharesRequest` (`{asset, signer, shares}`), `JupiterLendEarnTokenInfo`,
  `JupiterLendEarnUserPosition`, `JupiterLendEarnTokensResponse`, `JupiterLendEarnPositionsResponse`,
  `JupiterLendEarnEarningsResponse`, `JupiterLendEarnTransactionResponse` (`{transaction: string}`),
  `JupiterLendEarnInstructionResponse`, `JupiterLendEarnExecutionResult`
- `jupiter-lend/earn-api/client.ts:32` — Low-level REST clients:
  - Reads: `jupiterLendEarnTokens` (GET /tokens), `jupiterLendEarnPositions` (GET /positions?users=),
    `jupiterLendEarnEarnings` (GET /earnings?user=&positions=)
  - Tx builders (POST, returns `{transaction: base64}`): `jupiterLendEarnDepositTransaction`,
    `jupiterLendEarnWithdrawTransaction`, `jupiterLendEarnMintTransaction`, `jupiterLendEarnRedeemTransaction`
  - Instruction builders (POST, returns instructions array): `jupiterLendEarnDepositInstructions`,
    `jupiterLendEarnWithdrawInstructions`, `jupiterLendEarnMintInstructions`, `jupiterLendEarnRedeemInstructions`
- `jupiter-lend/earn-api/service.ts:143` — **Execute API (mutating, takes `secretKey: Uint8Array`):**
  - `executeJupiterLendEarnDeposit(secretKey, asset, amount): JupiterLendEarnExecutionResult`
  - `executeJupiterLendEarnWithdraw(secretKey, asset, amount): JupiterLendEarnExecutionResult`
  - `executeJupiterLendEarnMint(secretKey, asset, shares): JupiterLendEarnExecutionResult`
  - `executeJupiterLendEarnRedeem(secretKey, asset, shares): JupiterLendEarnExecutionResult`
  - All use `signAndSendVersionedTx` from shared/
  - Aliases: `executeLendEarnDeposit/Withdraw/Mint/Redeem`
  - Read wrappers: `getJupiterLendEarnTokens`, `getJupiterLendEarnPositions`, `getJupiterLendEarnEarnings`
  - Tx-request wrappers: `requestJupiterLendEarnDeposit/Withdraw/Mint/RedeemTransaction` (no signing)
  - Instruction wrappers: `requestJupiterLendEarnDeposit/Withdraw/Mint/RedeemInstructions`

### jupiter/jupiter-prediction/ (Jupiter Prediction API v1)

- `jupiter-prediction/constants.ts:3` — `JUPITER_PREDICTION_API_BASE_URL = "https://api.jup.ag/prediction/v1"`,
  `JUPITER_PREDICTION_USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"`,
  `JUPITER_PREDICTION_JUPUSD_MINT`
- `prediction-api/client/read.ts` — ~20 GET endpoints (events, search, market, orderbook, orders,
  positions, history, profile, pnl-history, trades, leaderboards, vault-info, trading-status)
- `prediction-api/client/write.ts:26` — POST/DELETE endpoints:
  - `jupiterPredictionCreateOrder(request)` — POST `/orders`; requires `JUPITER_API_KEY`
  - `jupiterPredictionClosePosition(positionPubkey, request)` — DELETE `/positions/{pk}`
  - `jupiterPredictionCloseAllPositions(request)` — DELETE `/positions` (fan-out)
  - `jupiterPredictionClaimPosition(positionPubkey, request)` — POST `/positions/{pk}/claim`
- `prediction-api/service.ts:96` — **Execute API (mutating):**
  - `executeJupiterPredictionCreateOrder(secretKey, request)` — resolves ownerPubkey from keypair → POST
    `/orders` → signs + sends versioned tx → `JupiterPredictionExecutionResult`
  - `executeJupiterPredictionClosePosition(secretKey, positionPubkey)` — DELETE tx + sign/send
  - `executeJupiterPredictionCloseAllPositions(secretKey)` — fan-out: iterates each
    `JupiterPredictionCloseAllPositionsResponse.data` item, executes each sequentially →
    `JupiterPredictionCloseAllExecutionResult` (items array, each `{kind: "order"|"claim", …}`)
  - `executeJupiterPredictionClaimPosition(secretKey, positionPubkey)` — POST /claim + sign/send
  - Read wrappers: `getJupiterPredictionEvents`, `searchJupiterPredictionEvents`, `getJupiterPredictionMarket`,
    `getJupiterPredictionPosition/Positions`, `getJupiterPredictionHistory`, `getJupiterPredictionProfile`,
    `getJupiterPredictionOrders`, `getJupiterPredictionTradingStatus`, etc.
- `prediction-api/types/` — split types: `base.ts` (enums, categories), `events-markets.ts`,
  `orders-positions.ts`, `profiles-tx.ts`
- `prediction-api/validation/` — split validators: `body.ts` (request bodies), `params.ts` (URL params),
  `helpers.ts`

### twitter-account/ (Rettiwt read-only client)

- `twitter-account/types.ts:1` — env var constants (`RETTIWT_API_KEY_ENV` etc.),
  `TwitterAccountRateLimit`, `TwitterAccountResult {action, data, rateLimit?}`, `CursoredJson<T>`
- `twitter-account/schema.ts:66` — Zod `TwitterAccountParamsSchema` — discriminated union on `action`
  (13 variants): `account_status`, `tweet_details`, `tweet_search`, `tweet_replies`, `tweet_likers`,
  `tweet_retweeters`, `space_details`, `user_details`, `user_search`, `user_timeline`, `user_replies`,
  `user_followers`, `user_following`. `tweet_search` requires `query` or `filter`. Username strips
  leading `@`. Export: `TwitterAccountParams = z.infer<typeof TwitterAccountParamsSchema>`
- `twitter-account/client.ts:25` — `executeTwitterAccountRequest(params): TwitterAccountResult` —
  creates `Rettiwt` instance per call from `RETTIWT_API_KEY`; dispatches to SDK via `executeAction`
  (exhaustive switch); cursored results normalized to `{items, next}` via `serializeCursored`;
  rate-limit headers captured into result. `sanitizeTwitterAccountError(error): string` — strips API key
  and auth tokens from error messages before surfacing.

## Key types & invariants

- `TokenMetadata` (`shared/types.ts:8`) — `{chain, address, symbol, name, decimals, logoUri?}`. Shared
  across all Jupiter sub-protocols and solana-constants well-known table. `chain` field references
  `ChainFamily` from `@tools/khalani/types.js`.
- `SwapClassification` (`shared/swap-classify.ts:22`) — `{tradeSide: "buy"|"sell"|null, instrumentMint, meta}`.
  Pure function, no side effects. Quote-set: SOL + USDC + USDT. Ambiguous (meme↔meme) → `tradeSide: null`,
  `meta.ambiguousSwap: true`. Stable↔stable → `tradeSide: null`, `meta.stableSwap: true`.
- `JupiterSwapExecutionResult` (`jupiter-swaps/types.ts:237`) — contains both `order` (pre-execute
  response) and `execute` (post-broadcast response). The protocol handler (`handlers/core.ts`) builds
  `_tradeCapture` from this, using `classifySolanaSwap` to derive `tradeSide` and `instrumentKey`.
- `JupiterLendEarnExecutionResult` (`earn-api/types.ts`) — `{signature, explorerUrl, asset, signer, raw}`.
  The `signer` field is the public key string derived from the keypair, NOT the agent wallet label.
- `JupiterPredictionCloseAllExecutionResult` — `{signer, results: JupiterPredictionCloseAllExecutionItem[],
  raw}`. Items carry `kind: "order"|"claim"` to distinguish close vs claim transactions. `closeAll` is
  the only Solana-prediction fan-out operation; it populates `_tradeCaptureItems` upstream.
- `StagedSubmissionResult` (`shared/solana-transaction.ts:224`) — `{signature, phase, errorKind?, errorHash?}`.
  `phase` = `confirmed | chain_failed | confirmation_unknown`. Only used by `wallet_send_confirm` internal
  tool (Solana native send); NOT used by Jupiter execution paths (those use the simpler throw-on-error
  `signAndSendVersionedTx`).
- **Auth invariant**: `requireJupiterApiKey` checks `process.env.JUPITER_API_KEY` at call time — not cached.
  Missing key → `VexError` with feature-specific `errorCode`. Called inside `getJupiterSwapHeaders`,
  `getJupiterPriceHeaders`, `getJupiterTokensHeaders`, `getJupiterLendHeaders`, `getJupiterPredictionHeaders`.
  All require vault unlock.
- **Twitter read-only invariant**: `TWITTER_ACCOUNT_TOOLS` (`registry/twitter-account.ts`) registers the
  tool as `mutating: false`, `actionKind: "read"`. The `executeAction` switch has no write path; all 13
  variants are read-only SDK calls. `assertNever` at the end catches any future action addition that
  escapes the switch.

## Capabilities (stable IDs)

### Jupiter Swaps

- **CAP-jupiter-swap-quote**: Get swap quote (read) — `jupiter-swaps/service.ts:112 getJupiterSwapQuote`
- **CAP-jupiter-swap-build**: Build tx instructions from quote — `jupiter-swaps/service.ts:136 buildSwapTransaction`
- **CAP-jupiter-swap-execute**: Execute swap (mutating — signs + broadcasts, requires secret key) —
  `jupiter-swaps/service.ts:155 executeJupiterSwap`

### Jupiter Prices

- **CAP-jupiter-prices-by-mint**: Batch price lookup by mint addresses —
  `jupiter-prices/service.ts:49 getJupiterPricesByMint`
- **CAP-jupiter-prices-by-query**: Resolve token + price by symbol/mint query —
  `jupiter-prices/service.ts:58 getJupiterPriceForTokenQuery`
- **CAP-jupiter-prices-batch-query**: Batch resolve + price for multiple queries —
  `jupiter-prices/service.ts:70 getJupiterPricesForTokenQueries`

### Jupiter Tokens

- **CAP-jupiter-tokens-search**: Search tokens by symbol, name, or mint —
  `jupiter-tokens/service.ts:45 searchJupiterTokens`
- **CAP-jupiter-tokens-trending**: Get trending/top-traded tokens by category, tag, or recent —
  `jupiter-tokens/service.ts:57 getJupiterTokensByCategory` + `getJupiterTokensByTag` + `getJupiterRecentTokens`
- **CAP-jupiter-tokens-resolve**: Resolve token query to `TokenMetadata` (cache + well-known + API) —
  `jupiter-tokens/service.ts:67 resolveJupiterToken` / `requireJupiterResolvedToken`

### Jupiter Lend

- **CAP-jupiter-lend-rates**: Fetch earn token rates/info (read) — `earn-api/service.ts:70 getJupiterLendEarnTokens`
- **CAP-jupiter-lend-positions**: Fetch positions + earnings for wallet (read) —
  `earn-api/service.ts:74 getJupiterLendEarnPositions`
- **CAP-jupiter-lend-deposit**: Deposit asset into earn vault (mutating) —
  `earn-api/service.ts:143 executeJupiterLendEarnDeposit`
- **CAP-jupiter-lend-withdraw**: Withdraw asset from earn vault (mutating) —
  `earn-api/service.ts:160 executeJupiterLendEarnWithdraw`
- **CAP-jupiter-lend-mint**: Mint shares for asset deposit (mutating) —
  `earn-api/service.ts:177 executeJupiterLendEarnMint`
- **CAP-jupiter-lend-redeem**: Redeem shares for asset withdrawal (mutating) —
  `earn-api/service.ts:194 executeJupiterLendEarnRedeem`
- **CAP-jupiter-lend-tx-request**: Request transaction without signing (all 4 variants) —
  `earn-api/service.ts:91 requestJupiterLendEarnDeposit/WithdrawTransaction` etc.
- **CAP-jupiter-lend-instructions**: Request raw Solana instructions (all 4 variants) —
  `earn-api/service.ts:115 requestJupiterLendEarnDeposit/WithdrawInstructions` etc.

### Jupiter Prediction

- **CAP-jupiter-prediction-events**: List prediction events with optional category/filter (read) —
  `prediction-api/service.ts:111 getJupiterPredictionEvents`
- **CAP-jupiter-prediction-search**: Search events by query (read) —
  `prediction-api/service.ts:117 searchJupiterPredictionEvents`
- **CAP-jupiter-prediction-market**: Get single market by ID (read) —
  `prediction-api/service.ts:149 getJupiterPredictionMarket`
- **CAP-jupiter-prediction-positions**: Get positions for wallet (read) —
  `prediction-api/service.ts:183 getJupiterPredictionPositions`
- **CAP-jupiter-prediction-history**: Get trade history for wallet (read) —
  `prediction-api/service.ts:195 getJupiterPredictionHistory`
- **CAP-jupiter-prediction-buy**: Create prediction order / buy outcome (mutating) —
  `prediction-api/service.ts:253 executeJupiterPredictionCreateOrder`
- **CAP-jupiter-prediction-sell**: Close position / sell outcome (mutating) —
  `prediction-api/service.ts:266 executeJupiterPredictionClosePosition`
- **CAP-jupiter-prediction-claim**: Claim expired/resolved position (mutating) —
  `prediction-api/service.ts:299 executeJupiterPredictionClaimPosition`
- **CAP-jupiter-prediction-close-all**: Close all open positions + claims in batch (mutating, fan-out) —
  `prediction-api/service.ts:278 executeJupiterPredictionCloseAllPositions`

### Solana shared primitives

- **CAP-solana-shared-transaction-versioned**: Deserialize + sign + send + confirm VersionedTransaction —
  `shared/solana-transaction.ts:111 signAndSendVersionedTx`
- **CAP-solana-shared-transaction-staged**: Staged legacy tx with post-broadcast phase classification —
  `shared/solana-transaction.ts:249 signAndSubmitLegacyTxStaged`
- **CAP-solana-shared-transfer-sol**: Native SOL transfer with balance check —
  `shared/solana-transfer.ts:30 sendSol`
- **CAP-solana-shared-transfer-spl**: SPL token transfer with ATA create-or-get —
  `shared/solana-transfer.ts:63 sendSplToken`
- **CAP-solana-shared-burn-spl**: Burn SPL token (full or partial) — `shared/solana-account.ts:18 burnSplToken`
- **CAP-solana-shared-close-empty**: Close empty SPL accounts, reclaim rent — `shared/solana-account.ts:62 closeEmptyAccounts`
- **CAP-solana-shared-swap-classify**: Pure swap classification → tradeSide + instrumentMint —
  `shared/swap-classify.ts:39 classifySolanaSwap`
- **CAP-solana-shared-token-cache**: File-based 24h token metadata cache —
  `shared/solana-token-cache.ts:62 getCachedSolanaToken` / `cacheSolanaTokens`
- **CAP-solana-shared-auth**: Jupiter API key resolve/require helpers — `shared/jupiter-auth.ts:12 requireJupiterApiKey`

### Twitter

- **CAP-twitter-read**: Read-only Twitter/X research via Rettiwt (13 action variants) —
  `twitter-account/client.ts:25 executeTwitterAccountRequest`

## Public API (consumed by)

### Direct consumers in vex-agent (Z3)

- `src/vex-agent/tools/protocols/solana-jupiter/handlers/core.ts` — imports `searchJupiterTokens`,
  `getJupiterTokensByCategory`, `getJupiterTokensByTag`, `getJupiterRecentTokens`,
  `getJupiterPricesByMint`, `getJupiterSwapQuote`, `executeJupiterSwap`, `classifySolanaSwap`, `SOL_MINT`
- `src/vex-agent/tools/protocols/solana-jupiter/handlers/lend.ts` — imports
  `getJupiterLendEarnTokens`, `getJupiterLendEarnPositions`, `getJupiterLendEarnEarnings`,
  `executeJupiterLendEarnDeposit`, `executeJupiterLendEarnWithdraw`
- `src/vex-agent/tools/protocols/solana-jupiter/handlers/predict.ts` — imports all prediction
  execute functions + read functions + `JUPITER_PREDICTION_USDC_MINT`
- `src/vex-agent/tools/internal/twitter-account.ts` — imports `TwitterAccountParamsSchema`,
  `executeTwitterAccountRequest`, `sanitizeTwitterAccountError`

### Internal cross-protocol dependency

- `jupiter-prices/service.ts` imports `requireJupiterResolvedToken` from `jupiter-tokens/service.ts`
  (token resolution before price lookup)
- `jupiter-swaps/service.ts` imports `requireJupiterResolvedToken` from `jupiter-tokens/service.ts`
  (token resolution before swap)
- All Jupiter sub-protocols import `requireJupiterApiKey` / `getJupiterHeaders` from `shared/jupiter-auth.ts`
- All mutating sub-protocols import `signAndSendVersionedTx` from `shared/solana-transaction.ts`
- `jupiter-tokens/service.ts` imports `getCachedSolanaToken` / `cacheSolanaTokens` from
  `shared/solana-token-cache.ts` and `getWellKnownSolanaTokenByMint/Symbol` from `shared/solana-constants.ts`

## Internal flow

### Dependency chain: shared → tokens → swap/prices/lend/prediction

```
shared/jupiter-auth.ts        (env key resolve/require)
shared/solana-constants.ts    (well-known token map)
shared/solana-validation.ts   (address check, amount conversions, explorerUrl)
shared/solana-transaction.ts  (connection singleton, sign+send, staged)
shared/solana-token-cache.ts  (file-based cache R/W)
     ↓
jupiter-tokens/client.ts      (raw HTTP to /tokens/v2)
jupiter-tokens/service.ts     (resolve: well-known → cache → API)
     ↓                             ↓
jupiter-swaps/service.ts      jupiter-prices/service.ts
(token resolve → order → sign → execute)  (token resolve → /price/v3)
     ↓
  shared/solana-transaction.ts:signVersionedTx
  shared/solana-transaction.ts:jupiterSwapExecute (HTTP)
     ↓ result → protocol handler
src/vex-agent/tools/protocols/solana-jupiter/handlers/core.ts
  classifySolanaSwap() → builds _tradeCapture{…}
  returns ToolResult with data._tradeCapture
     ↓
protocols/runtime.ts:captureExecution → protocol_executions DB
```

### Swap execution (mutating path)

1. Protocol handler (`handlers/core.ts:114 solana.swap.execute`) calls
   `resolveSigningWallet(ctx.walletResolution, …)` → gets `signer.secretKey: Uint8Array`
2. `executeJupiterSwap(input, output, uiAmount, secretKey)` in `jupiter-swaps/service.ts:155`:
   a. `resolveJupiterToken(input)` + `resolveJupiterToken(output)` — well-known → cache → API
   b. `uiToTokenAmount(uiAmount, decimals)` → atomic bigint
   c. `Keypair.fromSecretKey(secretKey)` — derive keypair inline
   d. `jupiterSwapOrder({inputMint, outputMint, amount, taker: keypair.publicKey.toBase58()})` →
      `JupiterSwapOrderResponse` with `transaction: string | null`
   e. `ensureExecutableOrder(order)` — throws `SOLANA_SWAP_FAILED` if transaction is null
   f. `deserializeVersionedTx(transactionBase64)` → VersionedTransaction
   g. `signVersionedTx(tx, [keypair])` — adds signature in-place
   h. `jupiterSwapExecute({signedTransaction, requestId, lastValidBlockHeight})` → `status: "Success" | "Failed"`
   i. Throws `SOLANA_SWAP_FAILED` on failure status; returns `JupiterSwapExecutionResult`
3. Handler builds `_tradeCapture` using `classifySolanaSwap` and returns `ToolResult{success:true, data}`
4. `captureExecution` in `protocols/runtime.ts` writes to `protocol_executions`, then projection pipeline

### Token resolution flow

1. `resolveJupiterToken(query)`:
   - `looksLikeMintQuery(query)` → route to mint lookup vs symbol search
   - Check `getWellKnownSolanaTokenByMint/Symbol` (in-memory O(1) map)
   - Check `getCachedSolanaToken(query)` (file read, TTL check)
   - If miss: `jupiterTokensByMint([query])` or `jupiterTokenSearch({query})`
   - `cacheSolanaTokens(results)` — write cache
   - `preferBestTokenMatch` — exact mint > exact symbol > exact name > first result
2. `requireJupiterResolvedToken` wraps with `SOLANA_TOKEN_NOT_FOUND` throw

### Lend execution (mutating path)

1. `handlers/lend.ts` calls `walletAddress(p, ctx)` + `walletSecret(ctx)` — resolve from session scope
   first, reject mismatched explicit address
2. `executeJupiterLendEarnDeposit(secretKey, asset, amount)` in `earn-api/service.ts:143`:
   a. `Keypair.fromSecretKey(secretKey)` → `signer`
   b. `jupiterLendEarnDepositTransaction({asset, amount, signer: publicKey})` → POST `/deposit` →
      `{transaction: base64}`
   c. `signAndSendVersionedTx(raw.transaction, [signer])` — versioned tx pipeline (retry ×3)
3. Returns `JupiterLendEarnExecutionResult {signature, explorerUrl, asset, signer, raw}`

### Prediction close-all (fan-out path)

1. `handlers/predict.ts:183 solana.predict.closeAll` resolves wallet + secret
2. `executeJupiterPredictionCloseAllPositions(secretKey)` in `service.ts:278`:
   a. DELETE `/positions {ownerPubkey}` → `JupiterPredictionCloseAllPositionsResponse.data: Item[]`
   b. For each item sequentially: `executePredictionTransaction(signer, item, "Close all positions")`
      → `signAndSendVersionedTx(item.transaction, [signer])`
3. Handler iterates `result.results`, builds per-item `_tradeCapture` with `kind: "order"|"claim"` and
   returns `_tradeCaptureItems` array
4. `protocols/capture-pipeline.ts:populateCaptureItems` fans out items individually to `proj_activity`

### Twitter request path

1. `tools/dispatcher.ts` routes `twitter_account` call → `handleTwitterAccount`
2. `Zod.safeParse(params)` via `TwitterAccountParamsSchema` — discriminated union validation
3. `createRettiwt(rateLimit)` — reads `RETTIWT_API_KEY` from env; optional proxy/timeout/delay/maxRetries
4. `executeAction(client, params)` — exhaustive switch; cursored results normalized to `{items, next}`
5. Rate-limit headers captured via `responseMiddleware` into `TwitterAccountRateLimit`
6. On error: `sanitizeTwitterAccountError` strips API key and auth token patterns before returning `fail(msg)`

## Dependencies

**Imports FROM:**
- `src/errors.ts` (`VexError`, `ErrorCodes`) — all files
- `src/config/store.ts` (`loadConfig`, `ensureConfigDir`) — `solana-transaction.ts`, `solana-token-cache.ts`
- `src/config/paths.ts` (`SOLANA_TOKEN_CACHE_FILE`) — `solana-token-cache.ts`
- `src/utils/http.ts` (`fetchJson`) — all HTTP clients
- `src/tools/khalani/types.ts` (`ChainFamily`) — `shared/types.ts`
- `rettiwt-api` npm package — `twitter-account/client.ts`
- `@solana/web3.js`, `@solana/spl-token` npm packages — shared/ primitives

**Consumed BY (Z3):**
- `src/vex-agent/tools/protocols/solana-jupiter/handlers/{core,lend,predict}.ts` — primary consumers
- `src/vex-agent/tools/internal/twitter-account.ts` — Twitter wrapper
- `src/vex-agent/tools/registry/twitter-account.ts` — ToolDef registration

**NOT consumed by vex-app/src/** — no direct imports from renderer, preload, or main process. The
protocol handler layer in Z3 is the exclusive consumer; vex-app reaches this only through the
engine IPC chain.

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-jupiter-swap-execute`,
  `#CAP-jupiter-lend-deposit`, `#CAP-jupiter-prediction-buy`, `#CAP-twitter-read`
- quality findings: `audits/current/quality-findings.md#FINDING-*`
- related modules: `module.vex-agent.tools-protocols` (manifest + handler registration + capture pipeline),
  `module.vex-agent.tools-internal` (dispatcher routing)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md` (per-session wallet affects
  `walletSecret()` / `walletAddress()` in handlers)

## Refresh triggers

This doc is stale when any of the following change:
- `src/tools/solana-ecosystem/**` — new Jupiter API surfaces, shared primitive changes, token cache logic
- `src/tools/twitter-account/**` — new actions, Rettiwt API version
- `src/vex-agent/tools/protocols/solana-jupiter/**` — handler import changes, new manifest entries
- `src/vex-agent/tools/internal/twitter-account.ts` or `src/vex-agent/tools/registry/twitter-account.ts`

## Open questions

1. **`closeEmptyAccounts` and `burnSplToken` consumers**: `shared/solana-account.ts` is not imported by
   any protocol handler in Z3 visible from this audit. These are likely consumed by an internal tool
   (wallet management) or a vex-agent internal not found via import search. Verify callers.
2. **Lend borrow SDK deferred**: `JUPITER_LEND_DEFERRED_AREAS` explicitly lists borrow/flashloan as
   not implemented. No stub exists. Confirm this is intentional scope exclusion.
3. **`signAndSubmitLegacyTxStaged` exclusivity**: Only `wallet_send_confirm` (internal tool) uses the
   staged submission path. All Jupiter execution paths use the throw-on-error `signAndSendVersionedTx`
   or `signAndSendLegacyTx`. This asymmetry is intentional per puzzle-5 phase-4 design but is not
   documented in the shared file.
4. **`JUPITER_API_KEY` for Lend**: The lend `earn-api/validation.ts:getJupiterLendHeaders` calls
   `requireJupiterApiKey` from `shared/jupiter-auth.ts`. Confirm whether the same key serves Swap,
   Prices, Tokens, Lend, and Prediction endpoints or whether separate keys are required per portal.jup.ag.
5. Superseded 2026-05-28: a fresh check found that `manifests/predict.ts` no longer lists
   `solana.predict.analyze` or `solana.predict.getStats`; older notes about missing handlers
   were stale.
