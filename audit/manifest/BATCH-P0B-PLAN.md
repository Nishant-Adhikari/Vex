# Batch P0-B — Privileged desktop + wallet god-file splits (A-005…A-008)

**Mode:** development. Aggressive refactor allowed; core invariants non-negotiable (secret/key handling, signing authority, Docker-no-silent-install, fail-closed restore, renderer-untrusted).
**Baseline:** `HEAD == origin/main == 0255c89` (P0-A landed), working tree clean (only `audit/`, screenshots, `memory-system.md` untracked).
**Execution:** 4 Opus-4.8 subagents in parallel, one per item, **file-disjoint**. Façade-preserving structural splits only — **ZERO behavior change**. These are pure structural cuts.

## Parallel-safety (file-disjoint via façades)

Each target stays at its current path as a compatibility façade re-exporting the IDENTICAL public surface. Cross-coupling resolves through façades, so no agent edits another's file:

| Imports… | …from | resolves via |
|---|---|---|
| A-007 `onboarding/wallets` → `restoreFromBackupArchive` | A-008 `backup-restore` (through `src/lib/wallet.ts`) | A-008 façade + unchanged `src/lib/wallet.ts` |

New subdirs are distinct: `compose/` (new sibling files), `database/sessions/`, `ipc/onboarding/wallets/`, `src/tools/wallet/restore/`. **No importer/caller file is modified** (incl. `src/lib/wallet.ts`, `register-all.ts`, `ipc/docker.ts`, the sessions IPC handlers). Existing thick suites are the characterization layer and must stay green; each item adds one tiny `*-surface.test.ts`.

**Cross-project note (edge-case rule #4):** A-008 lives in the ROOT project (`src/tools/wallet/`) and is bundled into vex-app via the `@vex-lib` alias (rolldown resolves from the root tree). The split must (a) keep `backup-restore.ts` a façade so `src/lib/wallet.ts`'s re-export stays stable, and (b) introduce **no new external dependency** — only reorganize existing code.

## B-000 obligations (every item)

1. Existing suites pin behavior — must pass unchanged through the façade.
2. Façade re-exports identical symbols; add one `*-surface.test.ts` asserting the exact runtime export-key set (+ type-only imports for type exports). Do NOT change caller imports.
3. Invariant-guard tests below stay green.
4. Move code verbatim — no renamed public symbols, no signature/error-string/log changes, no reordered side effects. Preserve file mode.

---

### A-005 — `vex-app/src/main/compose/lifecycle.ts` (821 LOC)

**Façade exports to preserve (exact):** `ComposeUpKind`, `ComposeUpResult`, `ComposeDownKind`, `ComposeDownResult`, `ComposeUpOptions`, `composeUp`, `composeDown`.
**New modules under `vex-app/src/main/compose/`:** `preflight.ts` (version floor, daemon, endpoint, disk, port checks) · `project.ts` (project names/labels + cwd/no-`-f` compose invocation contract) · `up.ts` (pull/up orchestration) · `health.ts` (service health polling + status mapping) · `stale-secret-recovery.ts` (pre-setup-only stale bind-mount cleanup) · `down.ts` (down + label fallback). Keep `composeUp`/`composeDown` as orchestrators in the façade.
**Non-test importers (untouched):** `ipc/docker.ts`, `lifecycle/secret-cleanup.ts`, `renderer/features/compose/bootstrap/parseComposeLog.ts`, `shared/local-service-ports.ts`.
**Invariant guards (stay green):** `compose/__tests__/lifecycle.test.ts`, `ipc/__tests__/docker-compose-up.test.ts`.
**Invariants:** compose invoked by **cwd, never `-f`** (edge-case #1/#2); **no silent Docker install/reconfigure**; post-setup stale-secret wipe still **refused**; cancellation respected; internal result fields preserved (incl. `pgPasswordPath`).

---

### A-006 — `vex-app/src/main/database/sessions-db.ts` (684 LOC)

**Façade exports to preserve (exact, 13):** `createSessionWithClient`, `createSession`, `SessionWalletScopeRow`, `getSessionWalletScope`, `initializeSessionWalletScopeWithClient`, `initializeSessionWalletScope`, `setInitialMissionGoalIfUnset`, `getSessionById`, `listSessions`, `softDeleteSessionWithClient`, `softDeleteSession`, `setSessionPinnedWithClient`, `setSessionPinned`.
**New modules under `vex-app/src/main/database/sessions/`:** `connection.ts` (the private `withClient` wrapper) · `mappers.ts` (DTO/status mapping — single source) · `create.ts` (`createSession*` + draft mission) · `wallet-scope.ts` (`SessionWalletScopeRow`, `getSessionWalletScope`, `initializeSessionWalletScope*`) · `mission-goal.ts` (`setInitialMissionGoalIfUnset`) · `read.ts` (`getSessionById`, `listSessions`) · `delete.ts` (`softDeleteSession*`) · `pin.ts` (`setSessionPinned*`).
**Non-test importers (untouched):** `ipc/chat.ts`, `ipc/wallets-session.ts`, `ipc/sessions/{list,create,get,set-pinned,delete}.ts`.
**Invariant guards (stay green):** `database/__tests__/sessions-db.test.ts`, `database/__tests__/sessions-wallet-scope.test.ts`, `ipc/__tests__/chat.test.ts`, `ipc/__tests__/session-wallet-scope-ipc.test.ts`.
**Invariants:** no query result-shape change; wallet-scope enforcement stays in main; status/DTO mapping single-sourced (no duplication).

---

### A-007 — `vex-app/src/main/ipc/onboarding/wallets.ts` (704 LOC)

**Façade export to preserve (exact):** `registerWalletHandlers`.
**New modules under `vex-app/src/main/ipc/onboarding/wallets/`:** `guards.ts` (password freshness, mutex, wallet-state guards) · `dialogs.ts` (file/dir dialog wrappers + realpath containment) · `generate.ts` · `import.ts` · `restore.ts` (restore archive/file handlers + runtime refresh) · `export.ts` (export/open backup) · `register.ts` (per-family registration aggregator). Keep `registerWalletHandlers` as the façade delegating to per-family registers.
**Non-test importer (untouched):** `ipc/register-all.ts`.
**Invariant guards (stay green):** `ipc/onboarding/__tests__/wallets.test.ts`.
**Invariants:** renderer receives only typed IPC results; all Node/Electron/dialog authority stays in main; restore keeps backup/path-containment checks and refreshes runtime after a successful restore; no secret leaks. Preserve handler registration order/teardown list shape.

---

### A-008 — `src/tools/wallet/backup-restore.ts` (722 LOC) — HIGHEST RISK (wallet crypto)

**Façade exports to preserve (exact):** `RestoreFromBackupArchiveArgs`, `RestoreFromBackupArchiveResult`, `restoreFromBackupArchive`.
**New modules under `src/tools/wallet/restore/`:** `archive.ts` (archive read/extract) · `manifest.ts` (manifest schema + validation) · `verify.ts` (decrypt/verify wallet material) · `stage.ts` (staging dir lifecycle) · `pre-restore-backup.ts` (mandatory pre-restore backup gate) · `commit.ts` (journaled commit + rollback) · `env-sanitize.ts` (`.env` sanitization + restored-vault detection). Keep `restoreFromBackupArchive` as the orchestrator in the façade.
**Non-test importers (untouched):** `src/lib/wallet.ts` (re-export — DO NOT EDIT), `vex-app/src/main/ipc/onboarding/wallets.ts`.
**Invariant guards (stay green):** `src/__tests__/wallet/archive-restore.test.ts`, `vex-app/src/main/ipc/onboarding/__tests__/wallets.test.ts`.
**Invariants:** restore stays **fail-closed**; preserve 4-phase order (validate → stage → mandatory backup → commit/rollback); **no partial wallet state** after injected commit failure; **secrets never logged**; no new external deps (rolldown/@vex-lib resolution must keep working through the unchanged `src/lib/wallet.ts` re-export).

---

## Verification protocol (owned by main Claude, after all 4 finish)

1. Root `pnpm exec tsc --noEmit` (covers A-008 + `src/**`).
2. `pnpm --dir vex-app lint` (project-wide tsc; covers A-005/006/007 + the `@vex-lib` resolution of A-008's split).
3. Single-process vitest, both projects, over the union of the invariant-guard suites + the four `*-surface.test.ts`:
   - root: `src/__tests__/wallet/archive-restore.test.ts`
   - vex-app: compose lifecycle + docker-compose-up + sessions-db + sessions-wallet-scope + chat + session-wallet-scope-ipc + onboarding wallets.
4. `git status` scope check: only the 4 façades modified + 4 new subdirs + 4 surface tests; **zero** importer files changed (incl. `src/lib/wallet.ts`, `register-all.ts`); audit/screens/memory untracked.
5. Codex final-review gate before any commit. Commit only on explicit user request, per-item staging, FF push `HEAD:main` after `origin/main == HEAD`.

## Open questions for Codex (plan-review gate)

1. Any HIDDEN COUPLING / circular import that breaks file-disjointness — esp. the private `withClient` in sessions-db shared by every query module, and shared compose helpers (logger, exec wrappers, port/secret utils)?
2. A-008: does the proposed seam risk changing the fail-closed 4-phase order, leaking a secret into a log, or breaking the `@vex-lib`/rolldown bundling given `src/lib/wallet.ts` stays unchanged? Any phase that must NOT be separated?
3. A-007: any handler-registration ordering or module-load side effect that must stay inside `registerWalletHandlers`? Confirm dialog/realpath-containment authority stays in main and is cleanly extractable.
4. Any item to serialize instead of parallelize, or any additional invariant-guard test I should pin before cutting (e.g. a no-secret-in-log assertion for A-008, a no-`-f` assertion for A-005)?
