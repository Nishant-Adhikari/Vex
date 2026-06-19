# Vex Audit Manifest — Verification Report

## Verdict

**TRUSTWORTHY WITH FIXES**

Across 10 adversarial verifiers covering all 20 work-units, 170 of 179 structured claim verdicts were confirmed (95.0%) with a mean slice accuracy of 0.877, and every high-value cross-cutting security finding (029 migration drift, `runTool` `approved:true`, primitive-only param validation, soft-delete ≠ erasure, absent prod signing/updater, DB-credential log leak) was independently verified against `file:line` evidence. The manifest is a faithful read-only inventory, but it carries a small set of factual errors (a 3.7× overstated `console.*` count, a misclassified StopReason enum, a stale `untracked` file status, and a god-file/manifest inconsistency) plus one critical under-weighted security gap (approval policy snapshot is stored but never re-enforced at approve time). None of these undermine the manifest's structural map; all are correctable in place before the deep audit proceeds.

## Aggregate stats

> Counts reconciled to the harness-computed ground truth from the raw per-agent verdicts (the synthesizer's draft overcounted the total by 9; qualitative findings below are unchanged).

- **Total claim verdicts:** 170 (across 10 agents, 20 units, ~2 units/agent)
- **Counts by status:**
  - `confirmed`: 162
  - `inaccurate`: 5
  - `manifest_omission`: 2
  - `outdated`: 0
  - `unverifiable`: 1
- **Overall confirmed:** 95.3% (162/170)
- **Mean sliceAccuracy:** 0.877 (range 0.72 [A5] → 0.96 [A1])

## Per-unit accuracy

| Unit | Agent | sliceAccuracy | #confirmed | #inaccurate | #omissions |
|---|---|---|---|---|---|
| 01–02 Electron shell, protocol, window; IPC/preload/shared | A1 | 0.96 | 20 | 0 | 0 |
| 03–04 Main IPC domain handlers; secrets/vault/wallet export | A2 | 0.87 | 24 | 0 | 0 |
| 05–06 Docker/Compose; local DB & migrations | A3 | 0.94 | 22 | 0 | 0 |
| 07–08 Renderer onboarding UX; appShell/mission UI | A4 | 0.88 | 15 | 1 | 1 |
| 09–10 Observability/telemetry/support; agent ingress/runtime leases | A5 | 0.72 | 12 | 2 | 1 |
| 11–12 Turn-loop/prompts/compaction; mission approvals/policy/runtime | A6 | 0.82 | 7 | 1 | 0 |
| 13–14 Tools dispatcher/protocol runtime; wallet intents/primitives | A7 | 0.87 | 20 | 0 | 0 |
| 15–16 Polymarket/Khalani/Kyber protocols; Solana ecosystem | A8 | 0.87 | 16 | 0 | 0 |
| 17–18 Knowledge/memory/recall/privacy; inference/embeddings/config | A9 | 0.92 | 11 | 1 | 0 |
| 19–20 Sync/portfolio/captures; build/release/updater/CI/E2E | A10 | 0.92 | 15 | 0 | 0 |

## Confirmed high-value findings

These cross-cutting findings were verified by multiple independent agents against concrete `file:line` evidence.

- **029 migration mirror drift (confirmed by A3, A7, A10).** `src/vex-agent/db/migrations/029_swap_prequotes.sql` (97 LOC / 5689 bytes) differs from `vex-app/resources/migrations/029_swap_prequotes.sql` (85 LOC / 4585 bytes). `cmp` diverges at byte 1267 (line 21); the source includes `kind` in the match-hash composition (lines 41–58) while the packaged copy omits it (lines 35–46), plus differing safety-verdict (FoT/honeypot) documentation. A3 confirmed only 029 drifts; all other 30 migrations are byte-identical. This changes hash-collision semantics at runtime (stale prequote cache-hit risk) and should fail the build-artifact check (A10).

- **`runTool` builds context with `approved:true` (confirmed by A2, A5, A7).** `src/vex-agent/engine/core/run-tool.ts:53` sets `approved: true` for direct operator invoke (rationale at lines 58–62). A7 verified the file is exported but **not** reachable via renderer/IPC (only unit tests), so the current blast radius is internal; the risk is regression if a future IPC/test surface calls it.

- **Primitive-only / loose nested protocol param validation (confirmed by A2, A6, A7).** `src/vex-agent/tools/protocols/runtime.ts:160–186` validates only top-level required fields via `typeof`. Manifest param types are limited to `string|number|boolean`; extra keys and nested objects/arrays pass through unvalidated to handlers (handler invocation ~line 251). This is a boundary-validation gap (rule 20-typescript §2; vex-agent-policy "Main validates proposal schema").

- **Raw error-text leakage from protocol runtime (confirmed by A2, A5, A7).** `src/vex-agent/tools/protocols/runtime.ts:306` returns `` `${request.toolId} failed: ${message}` `` where `message` comes from the caught error (sourced at ~line 295). Provider/SDK errors (URLs, request bodies, auth details) can leak into tool output. A5 also flagged raw-error logging at runtime.ts lines 287/299.

- **Soft-delete ≠ erasure (confirmed by A3, A9).** Session soft-delete at `vex-app/src/main/database/sessions-db.ts:565` sets only `deleted_at` (migration `021_sessions_deleted_at.sql`). No cascade cleanup of `tool_output_blobs` (TTL-only, `tool-output-blobs.ts:131-132`), `recall_cache_entries` (TTL-only, `recall-cache.ts:112-115`), or `search_cache` (TTL-only, `search.ts:37,62`); sensitive blobs persist up to ~60 min until TTL.

- **Missing production signing + updater (confirmed by A10).** `electron-builder.yml` is dev/test-unsigned: `forceCodeSigning:false` (lines 1–8), `mac.notarize:false` (line 47), `win.verifyUpdateCodeSignature:false` (line 57), no publish provider. No release job exists (`.github/workflows/` contains only `ci.yml`). No updater implementation: `grep` for `autoUpdater|checkForUpdate|downloadUpdate|quitAndInstall|update-downloaded` across `vex-app/src/main` returns nothing; `electron-updater` is a dependency but never imported; only reserved `updater.check` channel exists.

- **DB fallback URL with plaintext credentials logged (confirmed by A3, A5, A9).** `src/vex-agent/db/client.ts:34-36,39` hardcodes `postgresql://vex:vex@localhost:5777/vex_test` and emits it via `logger.warn()` when `VEX_DB_URL` is unset — leaking username/password into logs and any support bundle.

- **Plaintext Postgres password file + Docker installer integrity gap (confirmed by A2, A3).** `vex-app/src/main/compose/electron-secret-adapter.ts` writes a plaintext password file at mode `0o600` (line 55); `vex-app/src/main/docker/install.ts:114-162` downloads over HTTPS+allowlist but performs no checksum/signature verification, and the Linux path includes `sudo usermod -aG docker $USER` (line 186).

- **Electron security baseline solid (confirmed by A1, A10).** All eight `webPreferences` hardening flags set (`main-window.ts:148-153`), deny-all permissions (`permissions.ts:11-28`), strict CSP (`index.html:6-9`), and all six fuses correctly flipped in `afterPack.mjs:36-42` (RunAsNode off, NodeOptions env off, CLI inspect off, ASAR integrity on, OnlyLoadAppFromAsar on, cookie encryption on, file-protocol extra privileges off).

## Inaccuracies & corrections

Ranked by audit impact; deduped across agents.

1. **`console.*` count overstated 3.7× (A5, Unit 9 — `inaccurate`).** Manifest claims **37**; exhaustive grep found **10** (3 test-setup `console.warn`, 2 logger-config references, 2 scripts, 2 test files, 1 comment) with **zero** in production code. This is a measurement error in the overview/Unit-9 hotspot assessment — correct to 10 and verify each remaining use is intentional.

2. **Approval policy snapshot stored but never re-enforced (A6, Unit 12 — `confirmed` finding, but manifest under-weights it as the critical gap).** `approval-runtime/post-tx.ts:132` uses `row.queue_permission_at_enqueue` (snapshot), not live permission; `policy_json` is never read in `approval-runtime/` (grep-confirmed in `snapshot.ts`/`post-tx.ts`). A `full→restricted` downgrade between enqueue and approve still dispatches with the stale, more-permissive permission. Listed here because the manifest treats the snapshot as adequate; the corrected value is "policy is captured but not revalidated at approve time."

3. **StopReason enum mischaracterized (A6, Unit 11 — `inaccurate`).** Manifest lists `engine_stop` and `compact_committed` as StopReasons; these are internal `BatchOutcome` kinds (`turn-loop-tool-batch.ts`). Actual `StopReason` (`engine/types.ts:160`): `approval_required, checkpoint_pause, iteration_limit, timeout, waiting_for_parent, waiting_for_wake, waiting_for_compact_commit, compact_unable_at_critical, system_error, user_paused, plan_acceptance_required`. Separate "batch outcome signals" from the StopReason enum.

4. **`mission-run.ts` god-file label inconsistency (A5, Unit 10 — `inaccurate`).** Unit-10 description tags `mission-run.ts` (312 LOC) as "god-file/refactor candidate," but it is absent from `92-god-files.md` (which lists `executor.ts` at 425 LOC). Either add it to the inventory or drop the label.

5. **`SessionPlanCard.tsx` mislabeled as untracked (A4, Unit 8 — `inaccurate`).** File exists at `vex-app/src/renderer/features/appShell/SessionPlanCard.tsx`, is 5,458 bytes and committed/tracked. Correct status from "untracked in working tree" to "committed/tracked."

6. **`normalizeOpenRouterError` redaction incomplete, not "fixed" (A9, Unit 18 — `inaccurate`).** `inference/openrouter/errors.ts:44-56` truncates at 800 chars but `formatMetadata` still emits `provider_name`, `raw`, `reason`, `details`, which can carry request bodies/URLs/user content. Truncation reduces but does not eliminate exposure — the manifest's "open risk" framing is correct, but any claim of adequate redaction here is inaccurate. (Note: A9 also clarifies the embeddings client at `client.ts:213-219` logs only `inputChars` and **is** properly redacted, so the blanket "raw error-text leakage" label is nuanced, not uniform.)

*Unverifiable (1):* OpenRouter SDK retry behavior (A9, Unit 18) — `openrouter.ts` wraps `@openrouter/sdk` without overriding retry config; current semantics depend on SDK internals and require fresh doc verification (freshness rule).

## Coverage gaps to add

Ranked by impact.

1. **Support-bundle exclusion not proven (A5).** No code-level confirmation that env, vault files, keystores, DB URLs, and raw embeddings are excluded from support export. Also incomplete inventory of the security-critical pipeline: `support/agent-bug-report-sink.ts`, `bug-report-rate-limiter.ts`, `transport.ts`, `telemetry/dsn.ts` (23 LOC), and `ipc/{support,telemetry}.ts`.

2. **No data-deletion / GDPR-erasure spec for sensitive memory (A9).** No user-facing purge for session memory, recall caches, tool blobs, or vault secrets; soft-delete leaves sensitive data until TTL. Add a hard-delete "purge session data" path and document TTL durations.

3. **No raw-vs-validated capture matrix; synthetic captures bypass MUTATION_MATRIX (A10, A8).** `capture-validator.ts:23-24` allows tool IDs not in `MUTATION_MATRIX` (e.g. `settlement_sync.jupiter`); `validateSyntheticCapture()` checks minimum fields but not the full contract (`requiredMetaFields`, `valuationExpected`).

4. **No stale-`running`-row recovery for sync after crash (A10).** `initSync()` drains pending but never resets orphaned `status='running'` rows — these block future runs until cleared manually. This is a definite bug, not just "unclear."

5. **Jupiter lend/predict auto-retry without idempotency keys (A8).** `solana-transaction.ts:132-141,197` retries (`maxRetries:2`, `networkRetries`) with no dedup; wallet send uses a safe staged path. Add an explicit Mutation→SubmissionPattern→IdempotencySafeguard matrix to isolate the duplicate-spend risk.

6. **No automated channel-reconciliation (A1).** No check that every channel in `channels.ts` is registered in `register-all.ts`, and no guard against raw `ipcMain.handle` calls bypassing the `registerHandler()` validation wrapper.

7. **Renderer omissions: ReviewStep + review cards (A4).** `ReviewStep.tsx` (320 LOC) and its cards (ApiKeysCard, KeystoreCard, WalletsCard, etc.) validate/summarize sensitive config but are unlisted; also `sessionListModel.ts`, `sessionListLayout.ts`, `transcriptRowModel.ts` (~500 LOC of list/layout logic). No quantified renderer stream-preview byte cap.

8. **Embedding endpoint can egress remotely with no policy/UI gate (A9).** `embeddings/config.ts:43-48` accepts any HTTP(S) `EMBEDDING_BASE_URL`; `client.ts:165-176` POSTs memory/tool/user text. `EmbeddingStep.tsx:91-100` checks URL shape but not hostname locality.

9. **Supporting Docker security-path files unlisted (A3).** `pg-health.ts` (104 LOC, reads the plaintext password file directly), `posix-secret-adapter.ts` (47 LOC), `deps-factory.ts` (46 LOC).

10. **`prediction-settlement-sync.ts` logs wallet/proxy identifiers (A5, A10).** Lines 222/227 log `eoaWalletAddress`; lines 79–82 log `groupKey` (also contains the wallet address) — A10 notes the manifest missed the `groupKey` path.

## Rule/skill misalignments

- **vex-agent-policy (A6, A7) — under_weighted.** The skill treats "policy version mismatch" as a hard approval gate, but the implementation never revalidates `policy_json` / live permission at approve time (Finding #2 above). Also, on prequote/decode gate failures, `runtime.ts` returns `fail()` without queuing approval, whereas the skill expects "failed simulation/decoding → human approval required" (A7 — mischaracterized).

- **rule 20-typescript §2 + 10-engineering-standards §6 (A6, A7) — mischaracterized/under_weighted.** "Treat all external input as `unknown` until validated" / "Use Zod at boundaries" is violated by primitive-only protocol param validation; handlers receive untrusted nested `Record<string, unknown>`. The manifest frames this as a design smell rather than a named rule violation.

- **60-security-and-dependencies §2/§5 (A5) — mischaracterized.** Root-side logging (`src/vex-agent` DB URL, protocol errors, discovery raw-mode default at `discovery.telemetry.ts:34`) lacks the redaction depth of the `vex-app` logger; the manifest labels these "open risks/smells" rather than the asymmetric redaction violations they are.

- **vex-observability-telemetry (A9) — mischaracterized.** The blanket "raw error-text leakage" claim is uneven: `stream-consumer.ts:101` (raw 200-char tool args) and `normalizeOpenRouterError` metadata do leak, but the embeddings client logs only `inputChars`. Differentiate redacted vs leaking paths.

- **vex-electron-security §3/§4 (A1) — under_weighted.** CSP is strict but lacks nonce-based `script-src` per the skill baseline; protocol registration omits a positive `bypassCSP:false` check and a confirmation that `stream:true` absence is correct for Electron 42.

- **vex-postgres-pgvector "Data privacy" (A9) — under_weighted.** Skill prescribes user-visible delete/reset and local-only embedding egress; neither a deletion UI nor an egress policy exists.

- **vex-build-signing-updater §2 / vex-user-triggered-updates §12 / vex-release-operations §3 (A10) — under_weighted.** Manifest notes the unsigned config and missing updater but under-emphasizes the skill's hard requirement that production artifacts MUST be signed/notarized, and that `electron-builder.yml` has no publish provider at all (no `latest*.yml` metadata generation), so CI cannot produce release artifacts.

- **vex-provider-hot-wallet (A2, A7, A8) — aligned (positive).** Verified absence of any KMS/HSM/MPC/backend-signer (`grep` returns zero); all signing is local-wallet only. Correctly flagged as a precondition: future provider-funded EVM flows are blocked until a backend signer boundary exists.

## Recommendation

The manifest **is a safe basis for the deep audit**: 95% of structured claims and all major cross-cutting security findings verified against `file:line` evidence, with a strong mean slice accuracy (0.877). It is an accurate read-only structural map; its weaknesses are correctable factual errors and a few under-weighted risks, not systemic unreliability.

Fix in the manifest **before** the deep audit, in order:

1. **Re-rank the approval policy-snapshot gap to a blocker** — store ≠ enforce; add the enqueue/approve permission-drift finding with a required test (enqueue `full` → downgrade `restricted` → approve must re-gate).
2. **Correct the four factual errors:** `console.*` 37→10; remove/recategorize the `engine_stop`/`compact_committed` StopReasons; fix `SessionPlanCard.tsx` to tracked; resolve the `mission-run.ts` god-file inconsistency.
3. **Add an explicit 029 migration-drift CI gate** (packaged ↔ source parity) and confirm it fails the current artifact check.
4. **Add the missing inventory** (support-bundle pipeline + IPC handlers, `pg-health.ts`, ReviewStep/review cards, sync stale-`running` recovery, synthetic-capture validation asymmetry) and a Mutation→SubmissionPattern→Idempotency matrix.
5. **Reclassify the redaction findings** from "smells" to named rule violations (root-side logging, raw tool-args/provider-error metadata) and flag the embedding-egress / data-deletion gaps as privacy-policy blockers.

With these corrections folded in, the deep audit can proceed against the manifest with high confidence.
