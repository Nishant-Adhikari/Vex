# Batch P2-F — final clean production splits (A-062, A-044, A-045)

**Baseline:** `HEAD == origin/main == 835a127`. Clean tree (only always-excluded untracked: `audit/`, `Screenshot_1.jpg`, `Screenshot_2.jpg`, `memory-system.md`). 3 Opus agents parallel, file-disjoint, nested-subdir convention, ZERO behavior change. These are the LAST clean auto-splittable production A-items; A-046 (build `.mjs`) is deferred (crashes on `sharp` import in this env → no runnable equivalence guard; plan says "pair with pre-release build gates"), A-047 (SQL) deferred, A-057/058/059-061 are special-handling (visual/CSS/docs), and the T-001..T-015 test-splits are the next dedicated phase.

**Convention reminder (B-000):** original path kept as a façade re-exporting the EXACT public surface; new modules in a nested subdir named after the file; NO importer files modified; ESM `.js` import extensions; path aliases (`@vex-lib`, `@shared`, `@vex-agent`, `@utils`) unchanged; relative-import depth recomputed per nesting level.

---

## A-062 — `vex-app/src/main/ipc/onboarding/polymarket-setup.ts` (520) — SECURITY-critical IPC

**Public export (exact, 1):** `registerPolymarketSetupHandler(): () => void`.
**Single importer (UNTOUCHED):** `vex-app/src/main/ipc/register-all.ts` → `import { registerPolymarketSetupHandler } from "./onboarding/polymarket-setup.js"`.
**Guard (UNMODIFIED):** `vex-app/src/main/ipc/onboarding/__tests__/polymarket-setup.test.ts` (921 LOC) — exercises every branch.

**Conservative split (deliberately keeps the security-critical orchestration intact):** extract into `polymarket-setup/`:
- `errors.ts` — `ENGINE_CODE` const, `getEngineCode(cause)`, and ALL 11 `VexError` builder functions (`sessionLockedError`, `keystoreMissingError`, `keystoreCorruptError`, `walletNotFoundError`, `overwriteRequiredError`, `passwordInvalidError`, `vaultNotConfiguredError`, `vaultIoError`, `polymarketSetupFailedError`, `providerUnavailableError`, `unexpectedAcquireError`). Pure; only imports the `VexError` type. Move VERBATIM — every `code`/`domain`/`retryable`/`userActionable`/`redacted`/`message` byte-identical.
- `probe.ts` — `isWalletConfigured(entry)` + its result union; imports `getConfiguredPolymarketAddresses`, `getAddress`, `WalletInventoryEntry`, `VexError`.
- `credentials.ts` — `acquireCredentials(password, entry, correlationId)`: wraps `acquirePolymarketCredentialsWithPassword` with the engine-code→public-error try/catch (the lines mapping `KEYSTORE_NOT_FOUND`→keystoreMissing, `KEYSTORE_CORRUPT`→keystoreCorrupt, `KEYSTORE_DECRYPT_FAILED`→passwordInvalid, `POLYMARKET_AUTH_FAILED`→polymarketSetupFailed, `HTTP_REQUEST_FAILED`→providerUnavailable, else→unexpectedAcquire). Returns `{kind:"ok"; address; credentials} | {kind:"error"; error: VexError}`. Owns `AcquiredAddress`.
- `persist.ts` — `persistCredentials(args)`: the `withEnvWriteLock` block (TOCTOU re-check via `isWalletConfigured`, null-acquired defensive guard, `isPrimary` compute, `buildPolymarketVaultUpdates`, `writeUnlockedSecrets`) → `PersistOutcome`. Owns `PersistOutcome`.
- `register.ts` — `registerPolymarketSetupHandler()` + the `handle` orchestration (steps 2→9) wiring: session-unlock gate → wallet resolve (fail-closed null) → pre-network overwrite probe → re-auth (`verifySecretVaultPassword`) → `acquireCredentials` → `persistCredentials` → drop-ref (`acquired = null`) → audit switch. Imports the four modules above + `registerHandler`, `CH`, schemas, `getSecretSessionStatus`, `SECRETS_VAULT_FILE`, `log`.
- Façade `polymarket-setup.ts` → `export { registerPolymarketSetupHandler } from "./polymarket-setup/register.js";` + keep the top-of-file doc comment (the locked-spec flow narrative).

**HARD invariants (must NOT change):** (1) exact step ordering 2→9; (2) every gate fails CLOSED before network/write; (3) the TOCTOU re-check runs INSIDE `withEnvWriteLock`; (4) credentials reference dropped ASAP after the write (`acquired = null`); (5) logging contract — success logs ONLY `address=<X>` + `correlationId=<id>`, NEVER credentials/walletId/value/length/prefix; (6) the renderer-supplied `walletId` resolves through config inventory, never a renderer address. If splitting `credentials.ts`/`persist.ts` would risk any of these, fall back to keeping them inline in `register.ts` (only `errors.ts` + `probe.ts` extracted) — correctness over LOC.

**Codex-required NEW test (invariant 3 guard — REQUIRED before persist.ts extraction is safe):** the existing 921-LOC test's `withEnvWriteLock` mock (test line ~94) runs `fn()` inline, so it does NOT prove the 2nd configured-probe + `writeUnlockedSecrets` execute INSIDE the lock — moving the probe before the lock would still pass. The A-062 agent MUST add a dedicated test file `__tests__/polymarket-setup-lock-nesting.test.ts` that: wraps the `withEnvWriteLock` mock so it sets a module-scoped `inLock = true` for the duration of `fn()` (and `false` after), stubs the configured-probe (`getConfiguredPolymarketAddresses`) + `writeUnlockedSecrets` to record the `inLock` value seen at call time, drives ONE happy-path overwrite-confirmed setup, and asserts BOTH the under-lock probe AND the write observed `inLock === true`. Keep it minimal; reuse the existing test's mock factories where practical. Do NOT modify or reorganize the existing 921-LOC test (that is T-005, a separate phase).

---

## A-044 — `src/vex-agent/scripts/cross-lingual-benchmark.ts` (500) — maintenance script

**Public export (exact, 1):** `runBenchmark(outputPath?): Promise<BenchmarkReport>`. No code importers (CLI script; invoked `tsx src/vex-agent/scripts/cross-lingual-benchmark.ts`). Depends on A-045's façade — keep `import { BENCHMARK_LANGS, BENCHMARK_PAIRS, type BenchmarkLang, type BenchmarkPair } from "./cross-lingual-benchmark-dataset.js"`.

Extract into `cross-lingual-benchmark/`:
- `types.ts` — `Mode`, `PerPairResult`, `PerLangAggregate`, `BenchmarkReport`, `EmbeddedPair`.
- `score.ts` — `cosine`, `scoreMode`, `aggregate`, `pickWorstFailures` (pure math/scoring). EXPORT these (internal modules may widen exports beyond the façade) so the surface test can pin them.
- `embed.ts` — `embedAllPairs(config)` (the network embedding phase).
- `report.ts` — `fmtPct`, `fmtMargin`, `renderModeTable`, `renderWorstSection`, `renderReport`.
- `runner.ts` — `runBenchmark(...)` orchestration.
- Façade `cross-lingual-benchmark.ts` → `import { runBenchmark } from "./cross-lingual-benchmark/runner.js"; export { runBenchmark };` (a re-export-`from` creates NO local binding — Codex flag — and the retained CLI block calls `runBenchmark(...)`, so a LOCAL import binding is required). Then retain the `isMain` guard + the CLI block (lines ~465-500) AT THE ORIGINAL PATH — `import.meta.url === pathToFileURL(realpathSync(process.argv[1]))` must resolve against the invoked file. Keep top doc comment.

**Invariants:** `cosine` full-normalization math byte-identical; Mode-A dedupe-to-6-canonical-EN-docs vs Mode-B all-30 pool logic unchanged; report markdown template unchanged.

---

## A-045 — `src/vex-agent/scripts/cross-lingual-benchmark-dataset.ts` (431) — pure data literal

**Public exports (exact, 4):** `BenchmarkPair` (interface), `BENCHMARK_PAIRS` (`readonly BenchmarkPair[]`, 30 elements), `BENCHMARK_LANGS` (`readonly ["en","pl","fr","zh","vi"]`), `BenchmarkLang` (type). Consumed only by A-044 (file-disjoint via façade).

**Plan-deviation (honest):** GROUNDING-PLAN suggested `items.ts/normalize.ts/build.ts`, but this file has NO normalization/generation logic — it is a single 30-element fixture array. The honest split is the DATA-LITERAL pattern (same as A-036/A-038): per-language-group chunk modules re-assembled in the façade.

Extract into `cross-lingual-benchmark-dataset/`:
- `types.ts` — `BenchmarkPair` interface + `BENCHMARK_LANGS` const + `BenchmarkLang` type.
- `pairs-en.ts`, `pairs-pl.ts`, `pairs-fr.ts`, `pairs-zh.ts`, `pairs-vi.ts` — the 6 pairs per language, each `readonly BenchmarkPair[]`, moved VERBATIM (every id/lang/topic/queryNative/title*/summary* string byte-identical; preserve the non-ASCII zh/vi/pl/fr text exactly).
- Façade `cross-lingual-benchmark-dataset.ts` → re-assemble `export const BENCHMARK_PAIRS: readonly BenchmarkPair[] = [...enPairs, ...plPairs, ...frPairs, ...zhPairs, ...viPairs];` preserving EXACT element order (en→pl→fr→zh→vi, 6 each); re-export `BenchmarkPair`, `BENCHMARK_LANGS`, `BenchmarkLang` from `types.ts`. Keep top doc comment.

**Invariant:** `BENCHMARK_PAIRS` order + every string value byte-identical; 30 elements; ids unchanged.

---

## Surface tests (added by agents)
- A-044: `src/__tests__/vex-agent/scripts/cross-lingual-benchmark-surface.test.ts` — `typeof runBenchmark === "function"`; pin `cosine` (identity=1, orthogonal=0, dim-mismatch throws); pin `scoreMode("A")` dedupes to first-occurrence-per-topic (canonical EN pool) while `scoreMode("B")` keeps all docs; pin `aggregate` emits rows in `BENCHMARK_LANGS` order with mode A before B (Codex-required order pins) — use a tiny synthetic `EmbeddedPair[]` scenario from `score.ts`.
- A-045: `src/__tests__/vex-agent/scripts/cross-lingual-benchmark-dataset-surface.test.ts` — `BENCHMARK_PAIRS.length === 30`; exact ordered 30-id array; `BENCHMARK_LANGS` deep-equals `["en","pl","fr","zh","vi"]`; each pair has the 8 required keys; 6 pairs per lang.
- A-062: the existing 921-LOC `polymarket-setup.test.ts` stays (UNMODIFIED) as the branch guard, PLUS the agent ADDS the REQUIRED `__tests__/polymarket-setup-lock-nesting.test.ts` (the `inLock`-flag guard specified above) so invariant 3 is pinned after the persist.ts extraction.

## Verification (owned by main Claude)
1. root `pnpm exec tsc --noEmit` (covers A-044/A-045 — they compile under root tsconfig; dist proves it).
2. `pnpm --dir vex-app lint` (= `tsc --noEmit` + `check:boundaries`) — covers A-062.
3. root `pnpm exec vitest run --no-file-parallelism` over the 2 new surface tests.
4. vex-app vitest over BOTH the 921-LOC guard AND the new lock-nesting guard — run from repo root: `pnpm --dir vex-app exec vitest run --no-file-parallelism src/main/ipc/onboarding/__tests__/polymarket-setup.test.ts src/main/ipc/onboarding/__tests__/polymarket-setup-lock-nesting.test.ts`.
5. git scope: exactly 3 façades modified + 3 new subdirs + 3 new test files (A-044 surface, A-045 surface, A-062 lock-nesting); ZERO importer files; the existing 921-LOC `polymarket-setup.test.ts` UNCHANGED. Codex final → 3 per-item commits (path-scoped) → FF push `HEAD:main` after `origin/main == HEAD`.

## Open questions for Codex
1. **A-062:** is the conservative extraction (errors + probe + credentials + persist out; orchestration stays in `register.ts`) behavior-preserving for the 6 HARD invariants? Or should `credentials.ts`/`persist.ts` stay inline (only errors+probe extracted) to be maximally safe? Cite the lines for the TOCTOU re-check and the drop-ref. Does the 921-LOC test cover the policy/race/logging branches, or is a gap present?
2. **A-044:** confirm the `isMain` entrypoint MUST remain in the façade file (not `runner.ts`) for `process.argv[1]` resolution. Any hidden order dependence in `scoreMode`/`aggregate` I should pin?
3. **A-045:** confirm per-language-group split + façade re-assembly preserves EXACT `BENCHMARK_PAIRS` order and that nothing relies on a different grouping. Confirm the non-ASCII strings carry no risk beyond verbatim move.
4. Anything to serialize, or an additional invariant-guard (esp. A-062 fail-closed/logging).
