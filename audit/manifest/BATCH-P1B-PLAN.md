# Batch P1-B — IPC trust-boundary + balances god-file splits (A-013…A-016)

**Mode:** development. Façade/barrel-preserving structural splits, ZERO behavior change. This batch is the most trust-boundary-sensitive so far (shared IPC contract + central IPC safety + approval IPC).
**Baseline:** `HEAD == origin/main == c43f5e6`. Working tree clean.
**Execution:** 4 Opus-4.8 subagents in parallel, file-disjoint. **No contract change** — same exports, same shapes, same registered allowlists.

## Parallel-safety & coupling

Cross-imports resolve through façades/barrels: A-016 `approvals` → `registerHandler` (A-014) + `Result/VexError` (A-015); A-014 `register-handler` → `result.ts` (A-015). All keep their façade surface, so no agent edits another's file. New locations distinct: `db/repos/balances/` (subdir), `main/ipc/{sender-validation,cancellation,error-normalize}.ts` (siblings in ipc/), `shared/ipc/result/` (subdir, barrel at result.ts), `main/ipc/approvals/` (subdir). **No importer modified** (incl. the 143 importers of result.ts, 56 of register-handler.ts, register-all.ts, balance-sync/portfolio).

**Cross-project:** A-013 is root; A-014/A-015/A-016 are vex-app. Verify with root `tsc` + `vex-app lint` (whole-project tsc over ALL 143+56 importers + the process-boundary check, which guards that `shared/` stays pure) + both vitest.

## B-000 obligations
Existing suites pin behavior; façade re-exports identical symbols + a `*-surface.test.ts` pinning the EXACT runtime export-key set (+ type-only imports + for A-015 a deep-equality pin of `VEX_ERROR_CODES`/`VEX_DOMAINS`); move code VERBATIM; a module must never import its own façade; single-source shared private state/helpers.

---

### A-013 — `src/vex-agent/db/repos/balances.ts` (366 LOC)
**Façade exports (exact, 17):** `BalanceRow`, `ChainSummary`, `PortfolioSnapshot`, `SnapshotWalletFilter`, `InsertSnapshotArgs`, `upsertBalance`, `replaceBalancesForChain`, `getBalances`, `getBalancesByChain`, `getTotalUsd`, `InsertSnapshotResult`, `insertSnapshot`, `getLatestSnapshot`, `getSnapshotHistory`, `AggregateSnapshot`, `getAggregateSnapshots`, `getLatestAggregateSnapshot`.
**New modules under `db/repos/balances/`:** `types.ts` (BalanceRow, ChainSummary, PortfolioSnapshot, SnapshotWalletFilter, InsertSnapshotArgs, InsertSnapshotResult, AggregateSnapshot) · `mappers.ts` (row mappers, single-sourced) · `write.ts` (upsertBalance, replaceBalancesForChain) · `read.ts` (getBalances, getBalancesByChain, getTotalUsd) · `snapshots.ts` (insertSnapshot, getLatestSnapshot) · `history.ts` (getSnapshotHistory) · `aggregate.ts` (getAggregateSnapshots, getLatestAggregateSnapshot).
**Importers (untouched):** `sync/balance-sync.ts`, `tools/internal/inspect-views/portfolio.ts`.
**Guards:** `db/repos/balances.test.ts`, `sync/balance-sync.test.ts`, `tools/internal/portfolio-inspect.test.ts`.

---

### A-014 — `vex-app/src/main/ipc/register-handler.ts` (377 LOC) — CENTRAL IPC SAFETY
**Façade exports (exact):** `getCancelController`, `__resetCancelRegistryForTests`, `HandlerContext`, `HandlerArgs`, `registerHandler`.
**New modules (siblings under `main/ipc/`):** `sender-validation.ts` (sender/frame validation) · `cancellation.ts` (the cancel-registry SINGLETON + `getCancelController` + `__resetCancelRegistryForTests`) · `error-normalize.ts` (error-shape validation/normalisation). Keep `registerHandler` (orchestrator) + `HandlerContext`/`HandlerArgs` in the façade.
**CRITICAL:** the cancel registry is MODULE-LEVEL STATE — it must live in exactly ONE module (`cancellation.ts`) so `registerHandler` (façade), `getCancelController`, and `__resetCancelRegistryForTests` all share the SAME instance. Any other module-level singleton (rate limiters, maps) likewise single-sourced.
**Importers (untouched, 56):** all IPC domain handlers + register-all. **Guards:** `register-handler.test.ts`, `cancel.test.ts`, `ipc-handler-surface.test.ts`, `ipc-channel-registration-reconciliation.test.ts`.

---

### A-015 — `vex-app/src/shared/ipc/result.ts` (348 LOC) — SHARED IPC CONTRACT (143 importers, incl. renderer)
**Barrel exports (exact, 10):** `JsonValue`, `VexDomain`, `VexErrorCode`, `VexError`, `VEX_ERROR_CODES`, `VEX_DOMAINS`, `Result`, `ok`, `err`, `assertNever`.
**New modules under `shared/ipc/result/`:** `types.ts` (JsonValue, VexDomain, VexErrorCode, VexError, Result) · `codes.ts` (`VEX_ERROR_CODES`, `VEX_DOMAINS` — the registered allowlists, **byte-identical**, same order) · `constructors.ts` (ok, err) · `assert.ts` (assertNever). `result.ts` becomes a barrel re-exporting all 10.
**CRITICAL:** (a) renderer (untrusted) imports this — the new modules MUST stay PURE (no node/electron/main imports; the process-boundary check enforces it). (b) `VEX_ERROR_CODES`/`VEX_DOMAINS` arrays byte-identical incl. ordering — the registry/allowlist depends on it. (c) all 143 importers keep using `…/ipc/result` (the barrel) — do NOT change any importer.
**Importers (untouched, 143):** preload + renderer + main + shared. **Guards:** `shared/ipc/__tests__/result.test.ts`, plus tsc over the whole vex-app project.

---

### A-016 — `vex-app/src/main/ipc/approvals.ts` (322 LOC) — APPROVAL IPC
**Façade export (exact):** `registerApprovalsHandlers`.
**New modules under `main/ipc/approvals/`:** `read.ts` (list/get/history handlers) · `decision.ts` (approve/reject handlers) · `sweep.ts` (sweep lifecycle/timer) · `register.ts` (aggregator). Keep `registerApprovalsHandlers` in the façade delegating to per-family registers, returning the SAME teardown array order.
**CRITICAL:** any sweep timer / module-load side effect must stay started inside `registerApprovalsHandlers` (not at module top-level); preserve teardown order.
**Importer (untouched):** `ipc/register-all.ts` (via `./approvals.js`). **Guards:** `approvals-decision-ipc.test.ts`, `ipc-handler-surface.test.ts`.

---

## Verification protocol (owned by main Claude)
1. root `tsc --noEmit` (A-013). 2. `vex-app lint` (whole-project tsc over ALL 143+56 importers + boundary check — the real safety net for A-014/A-015/A-016). 3. single-process vitest both projects over the guard suites + 4 surface tests. 4. git scope: only 4 façades modified + new dirs/siblings + 4 surface tests; zero importers. 5. Codex final-review → per-item commit → FF push.

## Open questions for Codex (plan-review gate)
1. A-014: confirm the cancel registry (and any other module-level singleton) must be single-sourced in `cancellation.ts` and that `registerHandler`/`getCancelController`/`__resetCancelRegistryForTests` share it; any hidden module-load ordering?
2. A-015: confirm splitting into `shared/ipc/result/*` keeps it PURE (no privileged import → boundary check passes), the barrel preserves all 10 + `VEX_ERROR_CODES`/`VEX_DOMAINS` byte-identical, and no importer reaches a deep path (everyone uses the barrel). Is there a generated/registry consumer that depends on array identity/order?
3. A-016: any sweep timer / module-load side effect that must stay inside `registerApprovalsHandlers`? Confirm teardown-order preservation.
4. Given A-015 has 143 importers and A-014 has 56, is parallel safe or should A-015 (the contract) be serialized first? Any additional guard to pin (e.g. a `VEX_ERROR_CODES` deep-equality snapshot)?
