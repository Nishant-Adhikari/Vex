# Batch P1-E — Wallet/signing god-file splits (A-022, A-023, A-024, A-030)

**Mode:** development. Façade-preserving nested splits, ZERO behavior change. Signing/crypto-critical batch.
**Baseline:** `HEAD == origin/main == 32540d7`. Working tree clean.
**Execution:** 4 Opus-4.8 agents in parallel, file-disjoint. All root `src/`.

## Parallel-safety
Distinct dirs: `wallet/polymarket-credentials/`, `solana-ecosystem/shared/solana-transaction/`, `tools/internal/wallet/send/`, `kyberswap/handlers/zap/`. No importer modified. `signer-import-allowlist.test.ts` (FS-scanning) is run by the orchestrator single-process, NOT by agents.
Verify: root `tsc` + `vex-app lint` (A-022 is @vex-lib-reachable) + root vitest.

## A-022 — `src/tools/wallet/polymarket-credentials.ts` (412) — wallet-crypto
**Façade exports (exact):** `DeriveResult`, `AcquiredPolymarketCredentials`, `AcquireResult`, `acquirePolymarketCredentialsWithPassword`, `deriveAndSavePolymarketCredentials`.
**New modules under `wallet/polymarket-credentials/`:** `acquire.ts`, `derive.ts`, `api-key.ts`, `auth.ts`, `parse.ts` (per actual content — keystore decrypt, EIP-712 auth, CLOB api-key create, response parse). Single-source any shared decrypt/sign helper. **Never log secret/key/password material.**
**Importers (untouched):** `src/lib/polymarket.ts`, `tools/polymarket/credential-map.ts`, `vex-agent/tools/internal/polymarket-setup.ts`. **Guard:** `acquire-credentials.test.ts`, `per-wallet-credentials.test.ts`.

## A-023 — `src/tools/solana-ecosystem/shared/solana-transaction.ts` (426) — pairs B-007, signing
**Façade exports (exact, 12):** `deserializeVersionedTx`, `sendSignedVersionedTx`, `confirmVersionedTx`, `signAndSubmitVersionedTxStaged`, `signAndSendVersionedTx`, `signVersionedTx`, `getSolanaConnection`, `resetSolanaConnection`, `signAndSendLegacyTx`, `StagedSubmissionPhase`, `StagedSubmissionResult`, `signAndSubmitLegacyTxStaged`.
**New modules under `shared/solana-transaction/`:** `connection.ts` (the module-level Connection SINGLETON + getSolanaConnection + resetSolanaConnection — single instance) · `deserialize.ts` (deserializeVersionedTx) · `sign.ts` (signVersionedTx + signing helpers) · `send.ts` (sendSignedVersionedTx, signAndSendVersionedTx, signAndSendLegacyTx) · `confirm.ts` (confirmVersionedTx) · `staged.ts` (StagedSubmissionPhase/Result, signAndSubmitVersionedTxStaged, signAndSubmitLegacyTxStaged — the B-007 idempotency-safe staged path). Façade re-exports all 12.
**CRITICAL:** the Connection singleton MUST be single-instanced in connection.ts (getSolanaConnection + resetSolanaConnection share it). Preserve B-007 idempotency: after possible broadcast, retryable errors do NOT trigger a second non-idempotent send (the staged protocol). No reordered send/confirm.
**Importers (untouched):** jupiter earn/prediction/swaps services, solana-account, solana-transfer, `internal/wallet/send-execute-solana.ts`. **Guard:** `jupiter/__tests__/solana-transaction-idempotency.test.ts` (B-007), jupiter service tests.

## A-024 — `src/vex-agent/tools/internal/wallet/send.ts` (379) — signing authority
**Façade exports (exact):** `handleWalletSendPrepare`, `handleWalletSendConfirm`.
**New modules under `internal/wallet/send/`:** `prepare.ts` (handleWalletSendPrepare) · `confirm.ts` (handleWalletSendConfirm) · `validation.ts` (shared param/recipient validation) · `finalize.ts` (broadcast/finalize helpers). Façade keeps the two handlers.
**CRITICAL:** signing authority + idempotency (prepare→confirm flow, no double-broadcast); never log key material.
**Importers (untouched):** `db/repos/wallet-intents.ts`, `engine/types.ts`, `tools/dispatcher/internal-loaders.ts`, `tools/internal/wallet.ts`. **Guard:** `internal/wallet/send.test.ts`, `wallet.test.ts`.

## A-030 — `src/vex-agent/tools/protocols/kyberswap/handlers/zap.ts` (397)
**Façade export (exact):** `ZAP_HANDLERS` (Record<string, ProtocolHandler>).
**New modules under `kyberswap/handlers/zap/`:** `quote.ts` · `build.ts` · `execute.ts` · `validation.ts` (per actual content). Façade keeps `ZAP_HANDLERS`.
**CRITICAL:** the handler map shape + each handler's behavior (mutating broadcast) unchanged.
**Importer (untouched):** `kyberswap/handlers.ts`. **Guard:** `kyberswap-handlers.test.ts`.

## Verification (owned by main Claude)
root `tsc` + `vex-app lint` + root vitest over guards + 4 surface tests + `signer-import-allowlist.test.ts` (single-process). git scope: 4 façades + 4 subdirs + 4 surface; zero importers. Codex final → per-item commit → FF push.

## Open questions for Codex
1. A-023: confirm the Connection singleton must be single-sourced in connection.ts (getSolanaConnection/resetSolanaConnection share one cached Connection); is the B-007 staged-submission idempotency (post-broadcast no-resend) cleanly separable into staged.ts without reordering send/confirm? Cite lines.
2. A-022: shared decrypt/sign/crypto helper across acquire/derive to single-source; confirm no secret/key logging.
3. A-024: prepare→confirm shared validation/state; confirm no double-broadcast and signing authority intact.
4. A-030: ZAP_HANDLERS map + shared validation across quote/build/execute — any handler-registry coupling?
5. Anything to serialize / extra guard.
