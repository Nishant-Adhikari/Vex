# Vex Grounding & Split Plan

## Grounding

### Assumptions

- This is a development-mode plan: no public release, no installed users, and no production data compatibility burden.
- Refactors may be aggressive where they preserve core correctness and security invariants.
- Core invariants remain non-negotiable: approval gates, prequote fail-closed behavior, secret/key handling, and signing-authority boundaries must not be weakened.
- This pass is read-only. No files were edited, created, deleted, formatted, or tested.
- Current source paths differ from some shorthand paths in the prompt. The plan uses the actual repository paths found on disk.
- Current working tree churn affecting this plan: the manifest directory is untracked, plus `Screenshot_1.jpg`, `Screenshot_2.jpg`, and `memory-system.md`. I did not find heavy uncommitted churn in the target production source files or in the current session-plan files. The manifest’s “session plans feature is untracked” note appears stale against the current tree.

### Read And Verified Inputs

Read the requested manifest set:

- `audit/manifest/README.md`
- `audit/manifest/00-overview.md`
- `audit/manifest/01-trust-boundaries.md`
- `audit/manifest/90-decomposition-table.md`
- `audit/manifest/91-cross-cutting-findings.md`
- `audit/manifest/92-god-files.md`
- `audit/manifest/units/unit-01-*.md` through `unit-20-*.md`
- `audit/manifest/VERIFICATION.md`

Then inspected actual source files for the critical split targets and representative lower-priority targets.

### Path Corrections From Prompt To Current Source

| Prompt path | Current source path |
|---|---|
| `src/vex-agent/tools/swap-prequote.ts` | `src/vex-agent/tools/protocols/swap-prequote.ts` |
| `src/vex-agent/engine/dispatcher.ts` | `src/vex-agent/tools/dispatcher.ts` |
| `src/vex-agent/protocols/runtime.ts` | `src/vex-agent/tools/protocols/runtime.ts` |
| `src/vex-agent/approvals/approval-runtime/post-tx.ts` | `src/vex-agent/engine/core/approval-runtime/post-tx.ts` |
| `vex-app/src/main/local-services/compose/lifecycle.ts` | `vex-app/src/main/compose/lifecycle.ts` |
| `src/vex-agent/db/sessions-db.ts` | `vex-app/src/main/database/sessions-db.ts` |
| `vex-app/src/main/onboarding/wallets.ts` | `vex-app/src/main/ipc/onboarding/wallets.ts` plus `vex-app/src/main/onboarding/wallets-runner.ts` |
| `vex-app/src/main/backup-restore.ts` | `src/tools/wallet/backup-restore.ts`, re-exported through `src/lib/wallet.ts` |

## Part A - File-Split Plan

### Priority Model

- **P0**: Critical-path correctness/security files. Split first, with behavior-preserving facades and focused tests.
- **P1**: Important maintainability and reliability files on active runtime paths.
- **P2**: Large renderer, docs, scripts, schemas, and validation files where splitting improves maintainability but should not block correctness fixes.
- **P3**: Large tests. Split in parallel with the production file they cover where possible; otherwise after production seams settle.

### Recommended Sequence

1. Land FIX-NOW debt items `B-001`, `B-002`, `B-003`, `B-006`, and `B-007` before or alongside the first runtime splits. These protect the approval/prequote/provider-error/signing boundaries while refactoring.
2. Split critical agent runtime files: `A-001` through `A-004`.
3. Split local desktop privileged files: `A-005` through `A-008`.
4. Split P1 production/database/IPC/wallet/runtime support files: `A-009` through `A-031`.
5. Split P2 validation/docs/renderer/scripts/CSS files: `A-032` through `A-062`.
6. Split large tests in paired batches: `T-001` through `T-015`.

---

### A-001 - Split Swap Prequote Gate

**Priority:** P0  
**Churn:** No heavy uncommitted churn found in this file.

| Field | Plan |
|---|---|
| Path / LOC | `src/vex-agent/tools/protocols/swap-prequote.ts`, 1316 LOC |
| Why god-file | Manifest section 5 and unit coverage identify this as a critical fail-closed swap/bridge safety module. Actual code mixes quote tool registries, deterministic hash construction, bridge identity, EVM/Solana safety extraction, quote recording, and execute-time gate evaluation. |
| Proposed modules | `src/vex-agent/tools/protocols/prequote/registry.ts`: quote/gate tool maps and constants. `prequote/identity/hash.ts`: canonical quote identity and `computePrequoteMatchHash`. `prequote/identity/bridge.ts`: bridge identity/defaults and bindable identity helpers. `prequote/safety/extract.ts`: EVM/Solana quote extraction and verdict schemas. `prequote/record.ts`: quote-time persistence and row write helpers. `prequote/gate.ts`: execute-time fail-closed gate evaluation and block messages. |
| Exact seam | Cut on existing exported responsibilities: `PREQUOTE_QUOTE_TOOLS` / `EXECUTE_GATE_TOOLS`, hash builders, `buildBridgeIdentity`, `extractQuote`, `recordPrequoteFromQuote`, `evaluatePrequoteGate`, `evaluateSwapPrequoteGate`. |
| Original file | Keep as a compatibility facade exporting the same public symbols until callers/tests are migrated. Later reduce to barrel or remove after import updates. |
| Import surface | Preserve exports: `PREQUOTE_QUOTE_TOOLS`, `PREQUOTE_MAX_AGE_MS`, `computePrequoteMatchHash`, `buildBridgeIdentity`, `extractQuote`, `recordPrequoteFromQuote`, `EXECUTE_GATE_TOOLS`, `evaluatePrequoteGate`, `evaluateSwapPrequoteGate`. |
| Blast radius | Direct caller: `src/vex-agent/tools/protocols/runtime.ts`. Tests: `swap-prequote.test.ts`, `bridge-prequote.test.ts`, runtime prequote gate tests, dispatcher alias gate tests, DB prequote comment/type tests. |
| Test split | Pair with `T-003`: split into hash golden tests, EVM extraction tests, Solana extraction tests, recorder tests, execute gate tests, and bridge identity tests. |
| Acceptance | Existing prequote tests pass unchanged through facade. New module-level tests prove stale/missing/mismatched quotes fail closed and deterministic hash goldens do not change. |

---

### A-002 - Split Tool Dispatcher

**Priority:** P0  
**Churn:** No heavy uncommitted churn found.

| Field | Plan |
|---|---|
| Path / LOC | `src/vex-agent/tools/dispatcher.ts`, 478 LOC |
| Why god-file | Actual code mixes pressure-deny logic, plan acceptance enforcement, mission auto-retry restrictions, direct/protocol routing, mutating target classification, and internal tool loader map. This is a central execution boundary. |
| Proposed modules | `src/vex-agent/tools/dispatcher/pressure-gate.ts`: `checkPressureDeny`. `dispatcher/plan-acceptance-gate.ts`: `checkPlanAcceptanceDeny`. `dispatcher/mutating-targets.ts`: alias and target mutability classification. `dispatcher/internal-loaders.ts`: internal tool lazy loader map. `dispatcher/protocol-route.ts`: protocol/direct route selection. |
| Exact seam | Extract the existing named checks and constants first; keep `dispatchTool` as the orchestrator. |
| Original file | Keep `dispatchTool` and re-export current named helpers/constants. |
| Import surface | Preserve `checkPressureDeny`, `checkPlanAcceptanceDeny`, `dispatchTool`, `dispatchTargetIsMutating`, `INTERNAL_TOOL_LOADERS`. |
| Blast radius | Callers: `src/vex-agent/engine/core/turn-loop-tool-batch.ts`, `src/vex-agent/engine/core/approval-runtime/post-tx.ts`, `src/vex-agent/tools/run-tool.ts`. |
| Test split | Existing dispatcher tests should split into pressure, plan acceptance, alias/mutation, internal routing, protocol routing, and approval-context cases. |
| Acceptance | No behavior changes in mutating classification. Approved post-tx dispatch still flows through the same boundary. Unauthorized direct calls remain denied. |

---

### A-003 - Split Protocol Runtime

**Priority:** P0  
**Churn:** No heavy uncommitted churn found.

| Field | Plan |
|---|---|
| Path / LOC | `src/vex-agent/tools/protocols/runtime.ts`, 415 LOC |
| Why god-file | Manifest and source show mixed responsibilities: protocol discovery re-export, namespace/action validation, primitive parameter validation, prequote gate, approval gate, handler execution, quote recording, capture projection/audit, and raw error shaping. |
| Proposed modules | `src/vex-agent/tools/protocols/runtime/params.ts`: strict boundary validation, eventually Zod-backed. `runtime/gates.ts`: prequote and approval gate invocation. `runtime/capture.ts`: capture validation/projection/audit recording. `runtime/errors.ts`: provider-safe error normalization/redaction. `runtime/execute.ts`: handler execution orchestration. |
| Exact seam | Extract code around parameter validation, `evaluatePrequoteGate`, approval checks, `populateCaptureItems`, prequote recording, and catch/error formatting. |
| Original file | Keep `executeProtocolTool` and discovery re-export as facade. |
| Import surface | Preserve `executeProtocolTool` and existing discovery exports. |
| Blast radius | Callers: `src/vex-agent/tools/dispatcher.ts`, internal action aliases, protocol tests, sync/capture tests, pressure tests, wallet/protocol runtime tests. |
| Test split | Pair with `B-002`, `B-003`, and `B-006`. Add tests for strict nested validation, redacted provider errors, prequote denial, approval denial, handler success, and capture rejection. |
| Acceptance | Handler is not invoked on invalid params, denied approval, denied prequote, or invalid capture. Error strings and logs are redacted. |

---

### A-004 - Split Approval Post-Transaction Runtime

**Priority:** P0  
**Churn:** No heavy uncommitted churn found.

| Field | Plan |
|---|---|
| Path / LOC | `src/vex-agent/engine/core/approval-runtime/post-tx.ts`, 428 LOC |
| Why god-file | Source mixes approve/reject side effects, approved dispatch context construction, wallet hydration, execution status, tool-result persistence, continuation claim, and paused-error recovery. Verification flags approval snapshot drift as core debt. |
| Proposed modules | `approval-runtime/post-tx/policy-recheck.ts`: approve-time policy snapshot enforcement. `post-tx/dispatch-approved.ts`: approved tool dispatch context. `post-tx/result-message.ts`: append tool result and execution status mapping. `post-tx/reject.ts`: reject side effects. `post-tx/recovery.ts`: paused-error and continuation recovery. |
| Exact seam | Cut along existing approve path phases: load row, recheck policy, dispatch, persist result, claim continuation, handle recovery. |
| Original file | Keep exported approve/reject entrypoints as orchestration facade. |
| Import surface | Preserve public exports used by `approval-runtime.ts`. |
| Blast radius | Direct caller: `src/vex-agent/engine/core/approval-runtime.ts`. Tests: `approval-runtime.test.ts`, IPC approval tests, turn-loop approval tests. |
| Test split | Pair with `B-001`. Split tests into approve success, policy drift denial, reject, continuation, recovery, and dispatch failure. |
| Acceptance | Approve-time policy drift fails closed before dispatch. Existing approval continuation behavior remains intact. |

---

### A-005 - Split Compose Lifecycle

**Priority:** P0  
**Churn:** No heavy uncommitted churn found.

| Field | Plan |
|---|---|
| Path / LOC | `vex-app/src/main/compose/lifecycle.ts`, 821 LOC |
| Why god-file | Manifest/unit findings identify Docker local services as mandatory but sensitive. Actual file mixes Compose version floor, endpoint/daemon checks, compose rendering, port checks, reuse detection, pull/up orchestration, health polling, stale bind-mount/secret recovery, and down/label fallback. |
| Proposed modules | `vex-app/src/main/compose/preflight.ts`: version, daemon, endpoint, disk, and port preflight. `compose/project.ts`: project names, labels, cwd/no-`-f` compose invocation contract. `compose/up.ts`: pull/up orchestration. `compose/health.ts`: service health polling and status mapping. `compose/stale-secret-recovery.ts`: pre-setup-only stale bind-mount cleanup. `compose/down.ts`: down and label fallback. |
| Exact seam | Extract the existing phases without changing call ordering: preflight -> render -> reuse -> pull/up -> health -> recovery -> result. |
| Original file | Keep exported lifecycle functions as facade. |
| Import surface | Preserve result shapes, including internal fields currently stripped by IPC, such as `pgPasswordPath`. |
| Blast radius | Callers: `vex-app/src/main/ipc/docker.ts`, `vex-app/src/main/lifecycle/secret-cleanup.ts`. Tests: compose lifecycle and Docker IPC tests. |
| Test split | Split lifecycle tests by preflight, reuse, up, health, stale secret recovery, down/label fallback, cancellation. |
| Acceptance | No `-f` regression, no silent Docker install/reconfigure, post-setup stale-secret wipe still refused, cancellation still respected. |

---

### A-006 - Split Sessions Database

**Priority:** P0  
**Churn:** No heavy uncommitted churn found.

| Field | Plan |
|---|---|
| Path / LOC | `vex-app/src/main/database/sessions-db.ts`, 684 LOC |
| Why god-file | Main-process DB file mixes connection wrapper, row mappers, session creation, draft mission creation, wallet scope, first mission goal, get/list, soft delete, and pin state. This is a privileged desktop data boundary. |
| Proposed modules | `vex-app/src/main/database/sessions/connection.ts`: `withClient`. `sessions/mappers.ts`: DTO/status mapping. `sessions/create.ts`: create session and draft mission. `sessions/wallet-scope.ts`: wallet scope checks and assignment. `sessions/mission-goal.ts`: first mission goal lookup. `sessions/read.ts`: get/list queries. `sessions/delete.ts`: soft delete. `sessions/pin.ts`: pin/unpin. |
| Exact seam | Cut by query group and exported API behavior. Keep shared mapping in one module to avoid duplicated status logic. |
| Original file | Keep current exported functions as facade while call sites migrate gradually. |
| Import surface | Preserve current imports for sessions IPC, chat IPC, wallets session code, and tests. |
| Blast radius | Callers: sessions IPC create/list/get/set-pinned/delete, chat IPC, `wallets-session.ts`, renderer session tests through IPC. |
| Test split | Split database tests by create/read/list, wallet scope, pin, delete, and mission goal. |
| Acceptance | No query result shape change. Wallet scope remains enforced in main, not renderer. |

---

### A-007 - Split Onboarding Wallet IPC

**Priority:** P0  
**Churn:** No heavy uncommitted churn found.

| Field | Plan |
|---|---|
| Path / LOC | `vex-app/src/main/ipc/onboarding/wallets.ts`, 704 LOC |
| Why god-file | IPC registration file mixes handler registration, password freshness/mutex checks, dialogs, path containment, archive restore runtime refresh, wallet generation/import/add/export, and backup opening. It sits on a privileged wallet boundary. |
| Proposed modules | `vex-app/src/main/ipc/onboarding/wallets/guards.ts`: password freshness, mutex, wallet state guards. `wallets/dialogs.ts`: file/directory dialog wrappers and realpath containment. `wallets/generate.ts`: generate wallet handler. `wallets/import.ts`: import wallet handler. `wallets/restore.ts`: restore archive/file handlers and runtime refresh. `wallets/export.ts`: export/open backup handlers. `wallets/register.ts`: handler registration aggregator. |
| Exact seam | Extract one handler family at a time, keeping all Node/Electron/dialog authority in main. |
| Original file | Keep `registerWalletHandlers` facade delegating to per-family register functions. |
| Import surface | Preserve registration called by `register-all.ts`; no renderer API shape changes. |
| Blast radius | Callers: `vex-app/src/main/ipc/register-all.ts`; schemas/preload/renderer wallet APIs; onboarding wallet tests. |
| Test split | Split `wallets.test.ts` into generate/import/restore/export/guards/dialog containment. |
| Acceptance | Renderer still receives only typed IPC results. Restore keeps backup/path containment checks and refreshes runtime state after successful restore. |

---

### A-008 - Split Wallet Backup Restore

**Priority:** P0  
**Churn:** No heavy uncommitted churn found.

| Field | Plan |
|---|---|
| Path / LOC | `src/tools/wallet/backup-restore.ts`, 722 LOC |
| Why god-file | Manifest and source show a critical restore flow mixing archive manifest validation, decrypt/verify, staging, mandatory pre-restore backup, journaled commit, rollback, `.env` sanitization, and vault restore detection. |
| Proposed modules | `src/tools/wallet/restore/archive.ts`: archive read/extract helpers. `restore/manifest.ts`: manifest schema and validation. `restore/verify.ts`: decrypt/verify wallet material. `restore/stage.ts`: staging directory lifecycle. `restore/pre-restore-backup.ts`: mandatory backup gate. `restore/commit.ts`: journaled commit and rollback. `restore/env-sanitize.ts`: `.env` sanitization and restored vault detection. |
| Exact seam | Preserve existing four-phase order: validate -> stage -> mandatory backup -> commit/rollback. |
| Original file | Keep `restoreFromBackupArchive` orchestration facade. |
| Import surface | Preserve exports used through `src/lib/wallet.ts` and onboarding IPC. |
| Blast radius | Callers: wallet library facade and onboarding restore IPC. Tests: wallet archive restore tests. |
| Test split | Split archive restore tests by manifest validation, decrypt failure, staging cleanup, backup failure, commit success, rollback failure. |
| Acceptance | Restore remains fail-closed. No partial wallet state after injected commit failures. Secrets are never logged. |

---

## Additional Production Split Work Items

| ID | Priority | File / LOC | Why God-File | Proposed Seam And Files | Original / Imports / Tests |
|---|---:|---|---|---|---|
| A-009 | P1 | `vex-app/src/main/database/messages-db.ts`, 558 | Mixes DB connection, DTO mapping, secret-word redaction, tool-arg sanitizing, kind derivation, tail listing, general list, around-message lookup. | `messages/connection.ts`, `messages/mappers.ts`, `messages/redaction.ts`, `messages/list.ts`, `messages/tail.ts`, `messages/around.ts`. Seam is mapper/redaction/query family. | Keep facade exports. Tests split around redaction, tail, list pagination, around lookup. |
| A-010 | P1 | `vex-app/src/main/database/bug-reports-db.ts`, 447 | Mixes bug report model mapping, insert, recent listing, lookup, upload attempt mutation. | `bug-reports/mappers.ts`, `bug-reports/create.ts`, `bug-reports/read.ts`, `bug-reports/upload-attempt.ts`. | Keep facade. Tests by create/read/upload attempt. |
| A-011 | P1 | `src/vex-agent/db/repos/session-memories/crud.ts`, 465 | Mixes memory render preparation, inserts, list/get, stats, outstanding resolution, embedding update. | `session-memories/render.ts`, `create.ts`, `read.ts`, `stats.ts`, `resolution.ts`, `embeddings.ts`. | Preserve repo API. Tests by memory lifecycle and embedding update. |
| A-012 | P1 | `src/vex-agent/db/repos/messages.ts`, 374 | Mixes agent message repository writes/reads, mapping, filters. | `messages/mappers.ts`, `messages/write.ts`, `messages/read.ts`, `messages/filters.ts`. | Keep repo facade. Pair with turn-loop tests. |
| A-013 | P1 | `src/vex-agent/db/repos/balances.ts`, 366 | Mixes balance upsert/replace, snapshots, history, aggregate queries, mapping. | `balances/mappers.ts`, `balances/write.ts`, `balances/snapshots.ts`, `balances/history.ts`, `balances/aggregate.ts`. | Keep repo facade. Add focused balance repo tests. |
| A-014 | P1 | `vex-app/src/main/ipc/register-handler.ts`, 377 | Central IPC safety module mixes cancellation registry, sender validation, error shape validation, handler wrapping. | `ipc/sender-validation.ts`, `ipc/cancellation.ts`, `ipc/error-normalize.ts`, `ipc/register-handler.ts`. | Preserve `registerHandler`. Pair with `B-009` guard tests. |
| A-015 | P1 | `vex-app/src/shared/ipc/result.ts`, 339 | Shared boundary file mixes JSON typing, domains, error codes, `VexError`, `Result`, constructors, exhaustiveness helper. | `ipc/result/types.ts`, `ipc/result/errors.ts`, `ipc/result/constructors.ts`, `ipc/result/assert.ts`. | Keep barrel at current path to preserve preload/renderer/main imports. |
| A-016 | P1 | `vex-app/src/main/ipc/approvals.ts`, 318 | Mixes approval list/get/history/approve/reject IPC registration and sweep lifecycle. | `ipc/approvals/read.ts`, `ipc/approvals/decision.ts`, `ipc/approvals/sweep.ts`, `ipc/approvals/register.ts`. | Keep main-only. Pair with approval drift tests. |
| A-017 | P1 | `src/vex-agent/engine/core/approval-runtime/snapshot.ts`, 301 | Mixes snapshot construction, render/compare policy inputs, approval metadata. | `approval-runtime/snapshot/build.ts`, `snapshot/compare.ts`, `snapshot/render.ts`. | Preserve snapshot API. Pair with `B-001`. |
| A-018 | P1 | `src/vex-agent/engine/core/turn-loop-tool-batch.ts`, 413 | Mixes tool batch orchestration, stop payload/outcome handling, approval TTL, result aggregation. | `turn-loop/batch/execute.ts`, `batch/approval-stop.ts`, `batch/results.ts`, `batch/outcome.ts`. | Keep public batch entry. Pair with `T-002`. |
| A-019 | P1 | `src/vex-agent/engine/core/turn-loop.ts`, 383 | Mixes turn lifecycle, message planning, compaction/subagent hooks, stop reasons. | `turn-loop/run.ts`, `turn-loop/state.ts`, `turn-loop/stop-reason.ts`, `turn-loop/compaction.ts`. | Preserve main turn loop entry. Correct StopReason manifest docs separately in `B-004`. |
| A-020 | P1 | `src/vex-agent/engine/wake/executor.ts`, 425 | Mixes wake polling, claimed job handling, auto-retry handling, production dependency wiring, interval lifecycle. | `wake/executor/tick.ts`, `wake/executor/claimed.ts`, `wake/executor/auto-retry.ts`, `wake/executor/deps.ts`, `wake/executor/service.ts`. | Keep `startWakeExecutor` facade. Tests by claim path and retry path. |
| A-021 | P1 | `src/tools/wallet/backup.ts`, 421 | Mixes backup manifest schemas, auto backup, retention, archive manifest read, list available backups. | `wallet/backup/manifest.ts`, `backup/create.ts`, `backup/retention.ts`, `backup/read.ts`, `backup/list.ts`. | Keep exported backup API through wallet library. |
| A-022 | P1 | `src/tools/wallet/polymarket-credentials.ts`, 412 | Mixes credential acquisition, derivation, API key creation, auth headers, parse/save logic. | `wallet/polymarket-credentials/acquire.ts`, `derive.ts`, `api-key.ts`, `auth.ts`, `parse.ts`. | Preserve external functions. Ensure no secret enters renderer/logs. |
| A-023 | P1 | `src/tools/solana-ecosystem/shared/solana-transaction.ts`, 311 | Mixes deserialize, signing, send, confirmation, retry classification, staged submission. Verification flags Jupiter retry/idempotency risk. | `solana-transaction/deserialize.ts`, `sign.ts`, `send.ts`, `confirm.ts`, `retry.ts`, `staged.ts`. | Keep facade. Pair with `B-007`. |
| A-024 | P1 | `src/vex-agent/tools/internal/wallet/send.ts`, 379 | Mixes prepare, confirm, validation, finalization, internal wallet send policy. | `wallet/send/prepare.ts`, `send/confirm.ts`, `send/finalize.ts`, `send/validation.ts`. | Preserve internal tool handler exports. Pair with wallet send tests. |
| A-025 | P1 | `src/lib/local-secret-vault.ts`, 351 | Mixes KDF, encryption/decryption, status, create/verify/unlock/write, env apply/strip. | `local-secret-vault/crypto.ts`, `status.ts`, `lifecycle.ts`, `env.ts`. | Keep facade. Tests must assert no plaintext secret leaks. |
| A-026 | P1 | `vex-app/src/main/docker/probe.ts`, 342 | Mixes version parsing, semver checks, model/daemon parsing, port/disk probes, Docker probing. | `docker/probe/parsers.ts`, `docker/probe/version.ts`, `docker/probe/ports.ts`, `docker/probe/disk.ts`, `docker/probe/daemon.ts`, `docker/probe/index.ts`. | Preserve `probeDocker`. Pair with Docker preflight tests. |
| A-027 | P1 | `vex-app/src/main/ipc/wallet-export.ts`, 335 | Mixes export handler registration, error mapping, path handling, test exports. | `ipc/wallet-export/errors.ts`, `ipc/wallet-export/handler.ts`, `ipc/wallet-export/paths.ts`. | Preserve channel behavior and tests. |
| A-028 | P1 | `src/vex-agent/inference/openrouter.ts`, 439 | Mixes provider construction, request shaping, streaming/response parsing, retry/error normalization, redaction gaps. | `inference/openrouter/client.ts`, `request.ts`, `stream.ts`, `errors.ts`, `redaction.ts`. | Keep `OpenRouterProvider`. Pair with `B-003`. |
| A-029 | P1 | `src/vex-agent/tools/registry.ts`, 384 | Mixes tool registration, lookup, metadata, possibly built-in protocol/internal tool aggregation. | `tools/registry/types.ts`, `register.ts`, `lookup.ts`, `metadata.ts`, `builtins.ts`. | Keep existing registry import path as barrel. |
| A-030 | P1 | `src/vex-agent/tools/protocols/kyberswap/handlers/zap.ts`, 397 | Mixes Kyber zap quote/build/execute/validation handling. | `handlers/zap/quote.ts`, `zap/build.ts`, `zap/execute.ts`, `zap/validation.ts`. | Keep handler export map. Pair with Kyber tests. |
| A-031 | P1 | `src/vex-agent/tools/protocols/kyberswap/handlers/limit-order.ts`, 364 | Mixes limit-order quote/create/cancel/status handling. | `handlers/limit-order/create.ts`, `cancel.ts`, `status.ts`, `validation.ts`. | Keep handler export map. Pair with Kyber tests. |
| A-032 | P1 | `src/vex-agent/tools/protocols/polymarket/handlers-clob.ts`, 441 | Mixes CLOB handler map and helper logic. | `polymarket/clob/handlers/index.ts`, `orders.ts`, `markets.ts`, `positions.ts`, `auth.ts`. | Keep `CLOB_HANDLERS` public export. |
| A-033 | P1 | `src/tools/polymarket/clob/client.ts`, 365 | Mixes CLOB client request construction, auth, response handling. | `clob/client/http.ts`, `auth.ts`, `orders.ts`, `markets.ts`. | Preserve client API. Tests by endpoint family. |
| A-034 | P1 | `src/tools/polymarket/clob/validation.ts`, 383 | Mixes CLOB schemas for markets, orders, positions, auth responses. | `clob/validation/orders.ts`, `markets.ts`, `positions.ts`, `auth.ts`, barrel. | Keep barrel exports. |
| A-035 | P1 | `src/tools/polymarket/data/validation.ts`, 379 | Mixes Polymarket data schemas across markets/events/prices. | `data/validation/markets.ts`, `events.ts`, `prices.ts`, barrel. | Keep barrel exports. |
| A-036 | P1 | `src/vex-agent/tools/protocols/polymarket/manifests/clob.ts`, 412 | Large manifest mixes action definitions and schemas. | `manifests/clob/orders.ts`, `markets.ts`, `positions.ts`, `index.ts`. | Keep manifest barrel. |
| A-037 | P1 | `src/vex-agent/tools/protocols/polymarket/manifests/gamma.ts`, 460 | Large Gamma manifest mixes markets/events/search action definitions. | `manifests/gamma/markets.ts`, `events.ts`, `search.ts`, `index.ts`. | Keep manifest export. |
| A-038 | P2 | `src/vex-agent/tools/protocols/embeddings/polymarket/clob.ts`, 604 | Mixes embedding definitions, query text, metadata extraction for many CLOB entities. | `embeddings/polymarket/clob/orders.ts`, `markets.ts`, `positions.ts`, `index.ts`. | Preserve exported embedding registry. |
| A-039 | P2 | `src/vex-agent/tools/protocols/embeddings/polymarket/gamma.ts`, 556 | Same issue for Gamma embedding surfaces. | `embeddings/polymarket/gamma/markets.ts`, `events.ts`, `search.ts`, `index.ts`. | Preserve embedding registry. |
| A-040 | P2 | `src/tools/khalani/validation.ts`, 633 | Mixes chain/token/order/quote/deposit/submit/orders validation. | `khalani/validation/chains.ts`, `tokens.ts`, `orders.ts`, `quotes.ts`, `deposits.ts`, `submit.ts`, barrel. | Keep barrel exports. |
| A-041 | P2 | `src/tools/khalani/balances.ts`, 383 | Mixes Khalani balance fetch/parse/grouping behavior. | `khalani/balances/client.ts`, `parse.ts`, `aggregate.ts`. | Preserve exported balance helpers. |
| A-042 | P2 | `src/tools/dexscreener/validation.ts`, 562 | Mixes pair/profile/boost/order/ws/community/ad validators. | `dexscreener/validation/pairs.ts`, `profiles.ts`, `boosts.ts`, `orders.ts`, `websocket.ts`, `community.ts`, barrel. | Keep barrel exports. |
| A-043 | P2 | `src/tools/solana-ecosystem/jupiter/jupiter-prediction/prediction-api/schemas.ts`, 537 | Mixes many prediction API schemas: markets, orderbooks, orders, positions, profile, PnL, trades, leaderboard, vault, transaction endpoints. | `schemas/markets.ts`, `orderbooks.ts`, `orders.ts`, `positions.ts`, `profile.ts`, `pnl.ts`, `trades.ts`, `leaderboard.ts`, `vault.ts`, `transactions.ts`, barrel. | Keep schema barrel. Pair with `B-007`. |
| A-044 | P2 | `src/vex-agent/scripts/cross-lingual-benchmark.ts`, 500 | Script mixes CLI parsing, dataset loading, benchmark execution, output/reporting. | `scripts/cross-lingual-benchmark/cli.ts`, `dataset.ts`, `runner.ts`, `report.ts`. | Preserve script entrypoint. |
| A-045 | P2 | `src/vex-agent/scripts/cross-lingual-benchmark-dataset.ts`, 431 | Script mixes dataset fixtures, generation, normalization. | `cross-lingual-benchmark-dataset/items.ts`, `normalize.ts`, `build.ts`. | Preserve script entrypoint. |
| A-046 | P2 | `vex-app/scripts/check-build-artifacts.mjs`, 499 | Build gate mixes artifact discovery, platform expectations, signature-ish checks, reporting. | `scripts/check-build-artifacts/platforms.mjs`, `discover.mjs`, `checks.mjs`, `report.mjs`. | Preserve CLI entrypoint. Pair with pre-release build gates. |
| A-047 | P2 | `src/vex-agent/db/migrations/001_initial.sql`, 504 | Large initial schema mixes many tables/indexes/triggers. In dev mode migrations may be consolidated/reset, but runtime migration compatibility is not urgent. | Prefer migration reset/consolidation decision before splitting SQL. If retained, separate logical migration files by approvals, sessions, memory, sync, prequote, balances. | Do not split mid-release. Pre-release migration parity check covers this. |
| A-048 | P2 | `vex-app/src/shared/schemas/wallets.ts`, 465 | Shared schema file mixes wallet setup, import/export, restore, status, backup schemas. | `schemas/wallets/status.ts`, `setup.ts`, `import.ts`, `export.ts`, `restore.ts`, barrel. | Keep barrel path. Main/preload/renderer imports should remain shared-only. |
| A-049 | P2 | `vex-app/src/renderer/features/wizard/steps/ApiKeysStep.tsx`, 491 | Renderer component mixes form state, validation display, provider cards, IPC save/test flows. | `ApiKeysStep/state.ts`, `ProviderKeyCard.tsx`, `ApiKeyActions.tsx`, `validation.ts`. | Keep step component shell. Tests by provider card and save/test flow. |
| A-050 | P2 | `vex-app/src/renderer/features/wizard/steps/EmbeddingStep.tsx`, 394 | Mixes embedding provider status, form controls, setup/progress UI. | `EmbeddingStep/state.ts`, `ProviderSelector.tsx`, `EmbeddingProgress.tsx`. | Keep step shell. |
| A-051 | P2 | `vex-app/src/renderer/features/wizard/steps/wallets/RestoreFromArchive.tsx`, 414 | Mixes archive picker, password form, restore progress, errors, result display. | `RestoreFromArchive/state.ts`, `ArchivePicker.tsx`, `RestorePasswordForm.tsx`, `RestoreProgress.tsx`, `RestoreResult.tsx`. | Keep main component. IPC remains through preload. |
| A-052 | P2 | `vex-app/src/renderer/features/wallets/ExportPrivateKeyModal.tsx`, 392 | Mixes sensitive confirmation UX, password state, export request, result/error display. | `ExportPrivateKeyModal/state.ts`, `ConfirmPanel.tsx`, `PasswordPanel.tsx`, `ExportResult.tsx`. | Preserve modal API. Tests must assert no private key in logs/state snapshots. |
| A-053 | P2 | `vex-app/src/renderer/features/appShell/SessionRows.tsx`, 416 | Mixes session row rendering, selection, status badges, actions, empty/loading states. | `SessionRows/Row.tsx`, `StatusBadge.tsx`, `Actions.tsx`, `EmptyState.tsx`. | Keep exported `SessionRows`. Pair with AppShell test split. |
| A-054 | P2 | `vex-app/src/renderer/features/appShell/SessionCreator.tsx`, 380 | Mixes create form, wallet selection, mission/session mode, validation, submit flow. | `SessionCreator/Form.tsx`, `WalletScopePicker.tsx`, `ModeToggle.tsx`, `submit.ts`. | Keep component API. |
| A-055 | P2 | `vex-app/src/renderer/features/appShell/ApprovalCard.tsx`, 305 | Mixes risk classification, timeout/confirm state, decision actions, display. | `ApprovalCard/risk.ts`, `Countdown.tsx`, `DecisionActions.tsx`, `ApprovalDetails.tsx`. | Keep component API. Pair with approval runtime tests for semantics. |
| A-056 | P2 | `vex-app/src/renderer/features/systemCheck/SystemCheck.tsx`, 367 | Mixes system check orchestration, Docker/DB/embedding display, actions. | `SystemCheck/state.ts`, `DockerCheck.tsx`, `DatabaseCheck.tsx`, `EmbeddingCheck.tsx`, `Actions.tsx`. | Keep screen route. |
| A-057 | P2 | `vex-app/src/renderer/components/ui/dotmatrix-core.tsx`, 960 | Visual component mixes rendering primitives, animation/state, variants, accessibility wrappers. | `dotmatrix/primitives.tsx`, `animation.ts`, `variants.ts`, `DotMatrix.tsx`. | Keep public component exports. Visual regression tests/screenshots recommended. |
| A-058 | P2 | `vex-app/src/renderer/components/dotmatrix-loader.css`, 1121 | CSS god-file with many loader variants/keyframes/tokens in one file. | `dotmatrix/base.css`, `tokens.css`, `keyframes.css`, `variants/*.css`. | Keep current import via aggregate CSS. Check bundle order and visual screenshots. |
| A-059 | P2 | `src/tools/polymarket/Polymarket.md`, 620 | Large protocol doc mixes auth, market data, CLOB actions, examples, limits. | `docs/polymarket/auth.md`, `market-data.md`, `clob.md`, `examples.md`; current doc becomes index. | Preserve any doc links used by embedding/tool docs. |
| A-060 | P2 | `src/tools/kyberswap/KyberSwap.md`, 576 | Large protocol doc mixes swaps, zaps, limit orders, examples, caveats. | `docs/kyberswap/swaps.md`, `zaps.md`, `limit-orders.md`, `examples.md`; current doc index. | Preserve doc references. |
| A-061 | P2 | `src/tools/dexscreener/DexScreener.md`, 381 | Large protocol doc mixes endpoints, websocket, examples. | `docs/dexscreener/pairs.md`, `profiles.md`, `boosts.md`, `websocket.md`; index. | Preserve doc references. |
| A-062 | P2 | `vex-app/src/main/ipc/onboarding/polymarket-setup.ts`, 520 | Main IPC setup file mixes credential checks, wallet state, setup flow, error mapping. | `onboarding/polymarket-setup/guards.ts`, `credentials.ts`, `flow.ts`, `errors.ts`, `register.ts`. | Preserve IPC registration. Pair with polymarket setup tests. |

---

## Large Test Split Work Items

| ID | Priority | File / LOC | Split Plan | Pairing / Acceptance |
|---|---:|---|---|---|
| T-001 | P3 | `vex-app/src/renderer/features/appShell/__tests__/AppShell.test.tsx`, 1447 | Split by shell layout/sidebar, welcome/create flow, session list, composer, approval state, pin/delete/library behavior. | Pair with `A-053` and `A-054`. Each test file should own one renderer workflow and shared setup utilities move to `test-utils.tsx`. |
| T-002 | P3 | `src/__tests__/vex-agent/engine/core/turn-loop.test.ts`, 1311 | Split chat mode, mission mode, tool batch, approval stop, pressure/compaction, subagent behavior. | Pair with `A-018` and `A-019`. No test should require reading unrelated scenario setup. |
| T-003 | P3 | `src/__tests__/vex-agent/tools/protocols/swap-prequote.test.ts`, 1012 | Split hash goldens, EVM safety extraction, Solana safety extraction, recorder persistence, execute gate, edge cases. | Pair with `A-001`. Gate tests must prove fail-closed behavior. |
| T-004 | P3 — **DEFERRED (2026-06-06)** | `src/__tests__/integration/memory/long-mission.test.ts`, 1003 | Split long mission continuation, memory source filtering, compaction, stale claim/recovery, outstanding resolution. | Pair with memory repo splits. Keep integration setup shared. **FINDING (user-deferred): this file is run by NO config — it is the lone integration test named `*.test.ts` while the other 13 use `*.int.test.ts`; the default vitest config excludes `integration/**` and `vitest/integration.config.ts` includes only `**/*.int.test.ts`. So this 1003-LOC file is silently skipped by both `pnpm test` and `pnpm test:integration`. It also requires Docker (pgvector testcontainer + embeddings) to run. Git history shows a "PR4 sunset … initial eval harness" commit, so it may be an intentionally-dormant remnant. NOT split + NOT renamed (renaming → running is a behavior change that needs a separate decision + Docker to verify). Triage the misnaming separately before any split.** **CODEX DEAD-CODE VERDICT (2026-06-06): NOT dead — it was ADDED (not orphaned) by the PR4-sunset commit as the replacement eval harness, imports current modules, and has UNIQUE coverage no wired test provides (full `executeCompactNow → Track-2 executor → session_memories → memory_recall` lifecycle; outstanding-resolution-survives-compact; transcript redaction before chunker; provider-retry through executor; live-state exclusion; output redaction into body_md; theme fallback; 3-cycle + 20-cycle compaction). Some scenarios DO duplicate lower repo int-tests (cross-session recall, basic outstanding resolution, stale markCompleted, hot-context filter). It has DRIFTED stale and would FAIL a blind rename: `:312` reads `e.source` from `listActiveForHotContext` but `ActiveKnowledgeListItem` no longer exposes `source`; `:329` reads `h.entry.source` but recall now returns flat `RecallCandidate` (no `entry`/`source`). Recommendation: DO NOT delete, DO NOT blind-rename — repair the 2 stale knowledge-source assertions, then rename/split to `*.int.test.ts` (needs Docker to verify). USER DECISION (2026-06-06): LEAVE-AND-FLAG — file untouched; revive scheduled separately when Docker is available.** |
| T-005 | P3 | `vex-app/src/main/ipc/onboarding/__tests__/polymarket-setup.test.ts`, 921 | Split credential guard, setup success, failure mapping, wallet state, IPC registration. | Pair with `A-062`. |
| T-006 | P3 | `vex-app/src/main/ipc/__tests__/wallet-export.test.ts`, 881 | Split path validation, password guard, export success, failure mapping, cancellation. | Pair with `A-027` and `A-052`. |
| T-007 | P3 | `src/__tests__/vex-agent/tools/kyberswap-handlers.test.ts`, 841 | Split swap, zap, limit-order, validation/error cases. | Pair with `A-030` and `A-031`. |
| T-008 | P3 | `src/__tests__/vex-agent/engine/core/approval-runtime.test.ts`, 832 | Split enqueue/snapshot, approve success, approve policy drift, reject, continuation, recovery. | Pair with `A-004`, `A-017`, and `B-001`. |
| T-009 | P3 | `vex-app/src/main/ipc/onboarding/__tests__/wallets.test.ts`, 829 | Split generate, import, restore archive, export/open backup, password/mutex guards. | Pair with `A-007`. |
| T-010 | P3 | `src/__tests__/vex-agent/engine/core/runner.test.ts`, 821 | Split runner lifecycle, error handling, cancellation, state persistence. | Pair with engine turn-loop splits. |
| T-011 | P3 | `src/__tests__/vex-agent/tools/protocols/bridge-prequote.test.ts`, 683 | Split bridge identity, quote recording, gate matching, failure modes. | Pair with `A-001`. |
| T-012 | P3 | `vex-app/src/main/ipc/__tests__/register-handler.test.ts`, 681 | Split sender validation, cancellation, result shape, error normalization. | Pair with `A-014` and `B-009`. |
| T-013 | P3 | `src/__tests__/vex-agent/engine/telemetry-events.test.ts`, 613 | Split event schema, redaction, ordering, failure cases. | Pair with observability/redaction debt. |
| T-014 | P3 | `vex-app/src/main/ipc/__tests__/ipc-handler-surface.test.ts`, 600 | Split channel coverage, reserved channel allowlist, raw handler guard. | Pair with `B-009`. |
| T-015 | P3 | `src/__tests__/vex-agent/tools/internal/wallet/send.test.ts`, 588 | Split prepare, confirm, finalization, failure/redaction. | Pair with `A-024`. |

## Part B - Important-Now Technical Debt

### B-000 - Regression-Safety Protocol (GLOBAL - precondition for every A-/T-/B- item)

**Goal:** a new module/function must never break an existing one. Facades preserve the *public import surface*, but they only prove behavior-preservation where tests exist - and `VERIFICATION.md` found thin coverage in the exact P0 targets (strict nested validation, raw-error redaction, capture-failure-after-side-effects, full `runTool` caller audit). Every item MUST satisfy:

1. **Pin behavior before cutting.** For any file/branch with thin or no coverage, FIRST add characterization tests (golden/snapshot of current observable outputs - return values *and* error strings *and* edge branches). No split or behavior-touching fix lands without its current behavior pinned.
2. **Facade + public-surface assertion.** Keep a compatibility facade exporting the identical public symbols; prove the public surface is unchanged (typecheck + a re-export/"surface" test). Do not change caller imports in the same change as the internal split.
3. **Boundary contract tests.** For trust-boundary code (IPC channels/preload/shared, dispatcher, protocol runtime, approval runtime, wallet/signing), add/extend contract tests so a future feature cannot silently alter an existing contract (channel shape, Result/error model, approval gate, prequote fail-closed).
4. **Invariant guards.** Each core invariant - approval gate, prequote fail-closed, secret non-exposure, signing-authority scope - gets a dedicated negative test that must stay green across every item.
5. **Blast-radius gate (per item).** Before: run the suites named in the item's "Blast radius"/"Tests". After: re-run them green. A change that must touch a caller updates that caller's test in the same change.
6. **Standing regression gate (CI).** Add/keep a CI step that runs the affected-suite set per PR and the full suite on boundary files, so future features cannot regress existing ones. (Full matrix is pre-release, `D-007`.)

**Done =** for the item's change: characterization/contract tests added-or-present, public surface unchanged, affected suites green, invariant guards green.

### FIX-NOW Work Items

| ID | Priority | Item | Dev-Mode Rationale | Effort | Files Involved | Acceptance Criterion / Test |
|---|---:|---|---|---|---|---|
| B-001 | P0 | Re-enforce approval snapshot at approve time. | Core approval invariant, independent of release stage. In dev mode this is cheap to fix before flows spread further. | M | `src/vex-agent/engine/core/approval-runtime/post-tx.ts`, `snapshot.ts`, approval repo/types, `approval-runtime.test.ts`, IPC approval tests. | If policy changes between enqueue and approve, approve fails closed before dispatch. Test: enqueue under permissive policy, tighten policy, approve, assert no tool dispatch and safe failure result. |
| B-002 | P0 | Replace loose nested protocol param validation with strict Zod boundary validation. | Protocol tool boundary is a security/correctness boundary. Current primitive-only checks can miss nested shape drift. | M | `src/vex-agent/tools/protocols/runtime.ts`, protocol manifest/types, protocol runtime tests. | Extra keys, malformed nested params, and wrong nested types reject before handler invocation. Valid existing calls still pass. |
| B-003 | P0 | Redact raw provider errors before logs, tool results, telemetry, and renderer-visible strings. | Secret/key handling invariant. Provider errors can contain URLs, headers, payloads, API keys, or wallet-adjacent data. | M | `src/vex-agent/tools/protocols/runtime.ts`, `src/vex-agent/inference/openrouter.ts`, internal web/provider helpers, stream/error utilities, redaction tests. | Inject error containing API key, bearer token, credential URL, and body; assert none appear in logs, tool result, telemetry event, or IPC-visible message. |
| B-004 | P2 | Correct the five factual manifest/report inaccuracies. | Documentation debt is cheap now and prevents agents from planning from false premises. | S/M | `audit/manifest/*` docs only. | Corrections landed: console count is 10 and not prod code; StopReason labels corrected; `SessionPlanCard.tsx` tracked state corrected; `mission-run.ts` god-file inconsistency fixed; OpenRouter redaction marked incomplete. Also fix stale 170/179 aggregate wording in verification. |
| B-005 | P1 | Recover stale `running` sync jobs. | Definite runtime bug. No installed data means schema/semantics can be tightened without migration burden. | M | `src/vex-agent/sync/worker.ts`, `src/vex-agent/db/repos/sync.ts`, sync tests. | Running job older than timeout is requeued or failed according to policy; fresh running job is untouched; worker drains recovered job exactly once. |
| B-006 | P1 | Close synthetic-capture `MUTATION_MATRIX` bypass. | Capture contract affects correctness of mutation/audit projections. Unknown synthetic captures should not skip contract enforcement. | M | `src/vex-agent/sync/synthetic-capture.ts`, `src/vex-agent/tools/protocols/capture-validator.ts`, mutation matrix, prediction/settlement tests. | Synthetic capture has explicit contract or matrix-equivalent validation. Unknown synthetic tool IDs reject. Tests cover missing wallet/position/valuation fields. |
| B-007 | P0 | Make Jupiter retry behavior idempotency-safe. | Signing/broadcast retry is a core transaction safety issue. Dev mode is the right time to choose strict semantics. | M/L | `src/tools/solana-ecosystem/shared/solana-transaction.ts`, Jupiter prediction/lend handlers, Jupiter tests. | After possible broadcast, retryable network/confirmation errors do not cause a second non-idempotent send unless a safe idempotency/staged protocol is used. Test simulates post-send error and asserts one send. |
| B-008 | P1 | Redact DB fallback URL credential logging. | Cheap secret-handling fix. Even dev credentials should not train unsafe logging patterns. | S | `src/vex-agent/db/client.ts`, DB client tests. | Warning for missing `VEX_DB_URL` does not contain `vex:vex`, credential-bearing URL, or password. It may include host/port/db name in redacted form. |
| B-009 | P1 | Add IPC channel to `register-all` reconciliation guard. | IPC surface is a trust-boundary contract. Cheap guard prevents drift as refactors split handlers. | M | `vex-app/src/shared/ipc/channels.ts`, `vex-app/src/main/ipc/register-all.ts`, `vex-app/src/main/ipc/register-handler.ts`, IPC surface tests/scripts. | Test fails for unregistered non-reserved channels and for raw `ipcMain.handle` outside `register-handler.ts`. Reserved channels require explicit allowlist comments. |
| B-010 | P1 | Contain `runTool approved:true` semantics. | Internal-only escape hatches around approval must be guarded while refactoring dispatcher/runtime. | S/M | `src/vex-agent/tools/run-tool.ts`, dispatcher tests, approval/runtime tests. | `approved:true` path is unavailable from IPC/renderer and documented/test-guarded as internal-only. Mutating tools still require correct approval context when dispatched from user flows. |
| B-011 | P1 | Add provider-error redaction coverage for OpenRouter specifically. | Verification marked OpenRouter redaction incomplete; model providers often echo request details. | M | `src/vex-agent/inference/openrouter.ts`, extracted OpenRouter error module from `A-028`, inference tests. | Mock OpenRouter SDK/API error with headers/body/key material. Assert redacted code/message only, with no raw payload in logs or returned error. |

### DEFER-TO-PRE-RELEASE Checklist

These are not now-blockers under development mode, but must be explicit release gates.

| ID | Priority | Item | Dev-Mode Rationale | Effort | Files Involved | Acceptance Criterion / Test |
|---|---:|---|---|---|---|---|
| D-001 | Pre-release P0 | Code signing, notarization, Windows signing, and release artifact signature verification. | No public distribution yet, so not a coding blocker for current refactors. Must gate release. | L | Electron builder config, release workflows, artifact checker, signing docs. | Release CI fails unsigned/not-notarized macOS artifacts and unsigned Windows artifacts. Manual install smoke verifies OS trust prompts. |
| D-002 | Pre-release P0 | User-triggered updater UX and updater safety gates. | No installed users yet. Still required before publication because updates must not silently download/install. | L | updater main process, preload/shared channels, renderer update UI, electron-updater config. | Update check is user-triggered; no silent production auto-download/install; progress/restart UI is typed and tested. |
| D-003 | Pre-release P0 | GDPR/erasure UI and full local data deletion story. | No production users/data yet. Keep as release checklist, not current split blocker. | L | renderer settings, main delete handlers, DB repos, vault/support bundle paths. | User can delete local app data with explicit confirmation; sessions/memory/tool blobs/cache/support exports/vault-derived local files are covered or documented. |
| D-004 | Pre-release P1 | Plaintext Postgres password hardening beyond current local secret handling. | Current local dev password exposure is not a public-user blocker, but production packaging should harden. | M/L | Compose secrets, local services, support bundles, docs. | Credentials are not exposed in renderer/support bundles/logs; local secret files have restrictive permissions; threat model documented. |
| D-005 | Pre-release P1 | Docker installer checksum/signature guidance. | Vex must not silently install Docker. Pre-release installer guidance should prevent unsafe download instructions. | M | Docker onboarding UI/docs/system check. | Any Docker download link shows official source and checksum/signature guidance; app never installs/reconfigures Docker silently. |
| D-006 | Pre-release P1 | Migration `029` mirror drift runtime urgency and artifact parity. | No installed DBs exist, so no urgent expand/contract migration burden. Can reset/consolidate migrations before release. | S/M | migrations, packaged migration mirror/resources, migration tests. | Before release, canonical migration set and packaged mirror are identical; CI fails drift. If migrations are reset, docs and tests reflect new baseline. |
| D-007 | Pre-release P1 | Production Docker/live Compose CI matrix. | Important for release confidence, but not required before read-only split planning. | L | CI, Compose, local services, Docker probe/lifecycle tests. | CI or release QA exercises clean install, existing Docker, port conflict, stale secret, down/up, reset paths on supported OSes. |
| D-008 | Pre-release P1 | Build artifact publication metadata, checksums, rollback, and release notes process. | Commercial distribution concern. Keep out of current correctness split path. | M/L | release scripts, artifact checker, website/CDN metadata. | Every published artifact has checksum, version metadata, release notes, and rollback path. |
| D-009 | Pre-release P2 | Fresh verification of Electron protocol/CSP/update docs against current Electron/electron-updater versions. | Temporally unstable documentation; verify close to release date. | M | Electron main window/protocol/CSP/updater files. | Release review cites current official docs and tests packaged app navigation/CSP/update behavior. |

## Execution Notes For Multi-Agent Handoff

- **Apply `B-000` (regression-safety protocol) to every item** - pin behavior with characterization/contract tests BEFORE splitting or changing any low-coverage file; no item lands until its affected suites and invariant guards are green. This is the mechanism that stops a new function from breaking an existing one.
- Start with `B-001`, `B-002`, `B-003`, `B-006`, and `B-007` before major movement in `runtime.ts`, `dispatcher.ts`, and `post-tx.ts`.
- Preserve facades for every production split until all imports and tests are migrated. This keeps review diffs small and protects public import surfaces.
- For every split touching `vex-app/src/main` or preload/shared IPC, keep renderer untrusted: no Node, Electron, DB, Docker, filesystem, wallet, or signing authority moves into renderer.
- For every wallet/signing/provider split, add explicit redaction tests and approval/prequote denial tests before cleanup.
- For SQL/migration work, remember development mode permits consolidation, but release parity must be restored before publication.
- Verification for each executable item should use the smallest relevant `pnpm` target discovered from package scripts, then broaden only for shared boundary changes.
