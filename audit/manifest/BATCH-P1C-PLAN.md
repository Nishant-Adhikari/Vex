# Batch P1-C — Engine-core + wake + wallet-backup god-file splits (A-017, A-019, A-020, A-021)

**Mode:** development. Façade-preserving structural splits, ZERO behavior change. **Convention: nested subdir named after the file** for every item (no flat siblings).
**Baseline:** `HEAD == origin/main == b715526`. Working tree clean.
**Execution:** 4 Opus-4.8 subagents in parallel, file-disjoint. Coupled turn-loop pair is split across batches: this batch does A-019 (`turn-loop.ts`); A-018 (`turn-loop-tool-batch.ts`) is a LATER batch.

## Parallel-safety
Distinct domains/dirs: `approval-runtime/snapshot/`, `core/turn-loop/`, `wake/executor/`, `wallet/backup/`. Cross-imports resolve through façades (A-017 snapshot is imported by the committed A-004 post-tx modules + approval-runtime.ts; A-021 backup is imported by the committed A-008 restore modules + src/lib/wallet.ts). **No importer modified.**
**Cross-project:** A-020 (wake) + A-021 (wallet/backup) are root files imported by vex-app (via @vex-lib / engine). Verify with root `tsc` + `vex-app lint` + both vitest.

## B-000 obligations
Existing suites pin behavior; façade re-exports identical symbols + a `*-surface.test.ts` (exact runtime export-key set + type-only imports); move code VERBATIM; a module never imports its own façade; single-source shared private state/helpers; preserve file mode.

---

### A-017 — `src/vex-agent/engine/core/approval-runtime/snapshot.ts` (387 LOC) — pairs B-001
**Façade exports (exact):** `IntentSnapshotRow`, `ApproveSnapshot`, `RejectSnapshot`, `buildApproveSnapshot`, `buildRejectSnapshot`.
**New modules under `approval-runtime/snapshot/`:** `build.ts` (buildApproveSnapshot + buildRejectSnapshot orchestration — keep these as the owners) · `compare.ts` (the locked-tx SELECT + live-policy/drift comparison inputs) · `render.ts` (IntentSnapshotRow shaping + approval metadata). Keep the `ApproveSnapshot`/`RejectSnapshot` discriminated unions where their builders live (types.ts if cleaner).
**CRITICAL (B-001):** preserve the fail-closed ordering inside buildApproveSnapshot — the `FOR UPDATE OF i, q, s` row locks, TTL gate, terminal-run guard, the `policy_drift_blocked` variant returned BEFORE the `approveWith`/`markDecisionWith` CAS, and the live `s.permission` read. No reordering.
**Importers (untouched):** `engine/core/approval-runtime.ts`, `approval-runtime/post-tx/dispatch-approved.ts`, `approval-runtime/post-tx/reject.ts`.
**Guard:** `src/__tests__/vex-agent/engine/core/approval-runtime.test.ts` (covers buildApproveSnapshot incl. policy-drift). + `reject.test.ts`, `resume.test.ts`.

---

### A-019 — `src/vex-agent/engine/core/turn-loop.ts` (383 LOC) — MOST policy-sensitive
**Façade exports (exact):** `TurnLoopConfig`, `TurnLoopResult`, `runTurnLoop`.
**New modules under `core/turn-loop/`:** `state.ts` (TurnLoopConfig/TurnLoopResult + loop state) · `stop-reason.ts` (stop-condition/StopReason determination) · `compaction.ts` (compaction/pressure-band hooks) · `run.ts` (the runTurnLoop step orchestration, if extracted). Keep `runTurnLoop` as the orchestrator in the façade.
**CRITICAL:** preserve EXACT control flow + stop-reason semantics + side-effect ordering (inference call → tool batch → approval enqueue → pressure/compaction → stop). No StopReason renamed/reordered. Coexists with sibling `turn-loop-*.ts` files (tool-batch, prompt-stack, post-compact, text-response, plan-acceptance-pause, stop-conditions) — do NOT touch them.
**Importers (untouched):** `runner/{agent,shared,mission-run,setup-turn}.ts`, `subagents/runner.ts`.
**Guards:** `turn-loop.test.ts` (1311), `turn-loop-overflow.test.ts`, `turn-loop-defer.test.ts`, `runner.test.ts`, `mission-activation-message.test.ts`, `subagents/runner.test.ts`.

---

### A-020 — `src/vex-agent/engine/wake/executor.ts` (425 LOC)
**Façade exports (exact):** `ClaimedWakeOutcome`, `ClaimedWake`, `WakeDeps`, `tick`, `WakeExecutorHandle`, `StartOptions`, `startWakeExecutor`, `isWakeProviderConfigured`.
**New modules under `wake/executor/`:** `deps.ts` (WakeDeps + default production wiring) · `tick.ts` (tick + ClaimedWake/ClaimedWakeOutcome) · `claimed.ts` (claimed-job handling) · `auto-retry.ts` (auto-retry handling) · `service.ts` (startWakeExecutor + WakeExecutorHandle/StartOptions + interval lifecycle). Keep `startWakeExecutor`/`tick`/`isWakeProviderConfigured` exported from the façade.
**CRITICAL:** preserve interval/timer lifecycle (start/stop, no duplicate intervals); auto-retry must NOT retry unsafe mutating actions (preserve the guard); worker shutdown must not leak timers/handles; the WakeDeps dependency-injection seam unchanged.
**Importers (untouched):** `engine/index.ts`, `compact-jobs/executor.ts`, `vex-app/src/main/agent/wake-worker.ts`.
**Guard:** `src/__tests__/vex-agent/engine/wake/executor.test.ts`.

---

### A-021 — `src/tools/wallet/backup.ts` (421 LOC) — re-exported via src/lib/wallet.ts (@vex-lib)
**Façade exports (exact, 13):** `BackupFileRole`, `backupManifestV1Schema`, `backupManifestV2Schema`, `backupManifestSchema`, `BackupManifestV1`, `BackupManifestV2`, `BackupManifest`, `BackupManifestWallet`, `BackupFileEntry`, `autoBackup`, `enforceBackupRetention`, `readArchiveManifest`, `AvailableBackup`, `listAvailableBackups`.
**New modules under `wallet/backup/`:** `manifest.ts` (BackupFileRole, all backupManifest*Schema + inferred types — the schemas are the PUBLIC contract consumed by restore/) · `create.ts` (autoBackup) · `retention.ts` (enforceBackupRetention) · `read.ts` (readArchiveManifest) · `list.ts` (AvailableBackup, listAvailableBackups). Keep all 13 re-exported from the façade.
**CRITICAL (same as A-008):** keep the logger-shim import path (do NOT switch to src/utils/logger — rolldown/@vex-lib bundling); introduce NO new external dep; `src/lib/wallet.ts` re-export and `src/tools/wallet/restore/{manifest,pre-restore-backup}.ts` (committed A-008) stay UNCHANGED and keep resolving the schemas through the façade.
**Importers (untouched, 16):** `src/lib/wallet.ts`, `src/lib/wallet-backup.ts`, `tools/wallet/{create,import,solana-import,inventory-create,solana-create}.ts`, `tools/wallet/restore/{manifest,pre-restore-backup}.ts`, vex-app onboarding (`wallets/restore.ts`, `onboarding/{finalize,env-write-mutex,wallet-restore,wallet-mutex}.ts`), `shared/schemas/{finalize,wallets}.ts`.
**Guards:** `wallet/wallet-backup.test.ts`, `wallet/archive-restore.test.ts`, `wallet/backup-restore-surface.test.ts`, `wallet/inventory.test.ts`.

---

## Verification protocol (owned by main Claude)
1. root `tsc --noEmit` (all four are root `src/`). 2. `vex-app lint` (A-020 wake-worker + A-021 @vex-lib resolution + boundary). 3. single-process vitest both projects over the guard suites + 4 surface tests. 4. git scope: only 4 façades modified + 4 new subdirs + 4 surface tests; zero importers. 5. Codex final-review → per-item commit → FF push.

## Open questions for Codex (plan-review gate)
1. A-017: is the B-001 drift-block + `FOR UPDATE OF i, q, s` + CAS ordering cleanly separable into build/compare/render WITHOUT risking fail-closed-before-CAS? Any shared private helper across approve/reject snapshot to single-source?
2. A-019: any module-level state or ordering hazard splitting runTurnLoop into run/state/stop-reason/compaction? Confirm no StopReason rename/reorder and that the sibling `turn-loop-*.ts` files need not be touched.
3. A-020: what must stay inside `startWakeExecutor` (interval/timer, deps wiring) vs is cleanly extractable? Confirm the auto-retry-unsafe guard and single-interval lifecycle are preserved.
4. A-021: confirm logger-shim + @vex-lib rolldown safety (like A-008), that keeping the backupManifest schemas in `manifest.ts` + façade re-export keeps `restore/manifest.ts`/`pre-restore-backup.ts` resolving, and no importer reaches a deep path.
5. Anything to serialize, or an additional guard to pin.
