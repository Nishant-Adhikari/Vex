# Batch P1-A — DB repository god-file splits (A-009…A-012)

**Mode:** development. Façade-preserving structural splits, ZERO behavior change. Privileged main-process DB (A-009/010) + agent-runtime repos (A-011/012).
**Baseline:** `HEAD == origin/main == 2a6a46e` (P0 complete + B-002 fix; CI green). Working tree clean.
**Execution:** 4 Opus-4.8 subagents in parallel, file-disjoint, into distinct new dirs.

## Parallel-safety

Each target stays a compatibility façade re-exporting the IDENTICAL public surface. New dirs are distinct: `database/messages/`, `database/bug-reports/`, `db/repos/session-memories/` (new siblings beside the existing `crud.ts`/`index.ts`/`recall.ts`/`types.ts`), `db/repos/messages/`. **No importer/caller modified** — incl. `session-memories/index.ts` (barrel) + `recall.ts`, all engine importers of `db/repos/messages.ts`, the messages/support IPC handlers, `shared/schemas/messages.ts`. Big test files NOT split. Each item adds one `*-surface.test.ts`.

**Cross-project:** A-009/A-010 are vex-app; A-011/A-012 are root (`src/`). Verification needs root `tsc` + `vex-app lint` + both vitest runners.

## B-000 obligations (every item)
Existing suites pin behavior (must stay green through the façade); façade re-exports identical symbols + a `*-surface.test.ts` pinning the exact runtime export-key set (+ type-only imports); move code VERBATIM (no renamed symbols / signature / SQL / log / error-string changes / reordered side effects); a new module must NEVER import its own façade (cycle); single-source shared private helpers.

---

### A-009 — `vex-app/src/main/database/messages-db.ts` (558 LOC)

**Façade exports to preserve (exact):** `getMessageTail`, `listMessages`, `getMessageAround`.
**New modules under `vex-app/src/main/database/messages/`:** `connection.ts` (withClient/db helpers) · `mappers.ts` (row→DTO + kind derivation) · `redaction.ts` (secret-word redaction + tool-arg sanitizing — SECURITY-relevant, preserve verbatim) · `list.ts` (`listMessages`) · `tail.ts` (`getMessageTail`) · `around.ts` (`getMessageAround`). Keep the 3 functions exported from the façade.
**Non-test importers (untouched):** `ipc/messages.ts`, `shared/schemas/messages.ts`.
**Invariant guards:** `database/__tests__/messages-db.test.ts`, `ipc/__tests__/ipc-handler-surface.test.ts`.
**Invariant:** redaction/sanitize behavior unchanged (no secret leaks into listed messages); pagination/result shapes unchanged.

---

### A-010 — `vex-app/src/main/database/bug-reports-db.ts` (447 LOC)

**Façade exports to preserve (exact):** types `BugReportKind`, `BugReportSource`, `BugReportSeverity`, `BugReportStatus`, `BugReportUploadState`, `ContextPressureBand`, `BugReport`, `BugReportInsert`, `ListRecentArgs`; class `BugReportsDbUnavailableError`; functions `insertBugReport`, `listRecentBugReports`, `getBugReportById`, `bumpUploadAttempt`.
**New modules under `vex-app/src/main/database/bug-reports/`:** `types.ts` (the exported type/interface set + ContextPressureBand) · `mappers.ts` (row→`BugReport` mapping) · `create.ts` (`insertBugReport`) · `read.ts` (`listRecentBugReports`, `getBugReportById`, `ListRecentArgs`) · `upload-attempt.ts` (`bumpUploadAttempt`). Keep `BugReportsDbUnavailableError` + the connection/db-unavailable handling single-sourced (e.g. in a `connection.ts` or co-located). Façade re-exports everything.
**Non-test importers (untouched):** `ipc/support.ts`, `support/transport.ts`, `support/bug-report-service.ts`.
**Invariant guards:** `database/__tests__/bug-reports-db.test.ts`, `support/__tests__/bug-report-service.test.ts`.
**Invariant:** no result-shape change; sensitive-data retention behavior unchanged.

---

### A-011 — `src/vex-agent/db/repos/session-memories/crud.ts` (465 LOC)

**Façade exports to preserve (exact):** `InsertResult`, `PreparedMemoryRender`, `prepareMemoryRender`, `insertPreparedMemory`, `insertMemories`, `getById`, `listActiveBySession`, `SessionMemoryStats`, `getSessionMemoryStats`, `ResolveOutstandingResult`, `markOutstandingResolved`, `updateEmbedding`.
**New modules under `src/vex-agent/db/repos/session-memories/` (siblings beside crud.ts):** `render.ts` (`PreparedMemoryRender`, `prepareMemoryRender`) · `create.ts` (`InsertResult`, `insertPreparedMemory`, `insertMemories`) · `read.ts` (`getById`, `listActiveBySession`) · `stats.ts` (`SessionMemoryStats`, `getSessionMemoryStats`) · `resolution.ts` (`ResolveOutstandingResult`, `markOutstandingResolved`) · `embeddings.ts` (`updateEmbedding`). crud.ts becomes a re-export façade.
**Non-test importers (untouched):** `session-memories/index.ts` (barrel), `session-memories/recall.ts`, `engine/compact-jobs/{chunk-processing,forced-fallback}.ts`, `engine/core/turn-loop-prompt-stack.ts`, `engine/prompts/memory-state.ts`, `tools/internal/memory/{mark-resolved,recall}.ts`.
**Invariant guard (runnable):** `src/__tests__/vex-agent/db/repos/session-memories/body-md-hash.test.ts`.
**Coverage caveat:** the deep guards are integration tests needing real Postgres (`integration/repos/session-memories*.int.test.ts`, `integration/memory/long-mission.test.ts`) — NOT run in the parallel pass. Mitigate with strict-verbatim move + façade + surface test + tsc; flag `.int` suites for a DB-backed/CI run.
**Invariant:** `prepareMemoryRender → insertPreparedMemory` chain + body-md hashing + outstanding-resolution semantics unchanged.

---

### A-012 — `src/vex-agent/db/repos/messages.ts` (374 LOC)

**Façade exports to preserve (exact):** consts `MESSAGE_DB_COLUMNS`, `MESSAGE_ARCHIVE_DB_COLUMNS`; types `MessageRow`, `Message`, `MessageWithId`, `MessageMetadata`, `ArchivePrefixPlan`; functions `addMessageReturningId`, `addMessage`, `addEngineMessage`, `getLiveMessages`, `getLiveMessagesWithId`, `getOperatorInstructionsAfter`, `getAllMessages`, `selectArchivePrefix`.
**New modules under `src/vex-agent/db/repos/messages/`:** `columns.ts` (`MESSAGE_DB_COLUMNS`, `MESSAGE_ARCHIVE_DB_COLUMNS`) · `types.ts` (`MessageRow`, `Message`, `MessageWithId`, `MessageMetadata`) · `mappers.ts` (row→`Message` mapping) · `write.ts` (`addMessageReturningId`, `addMessage`, `addEngineMessage`) · `read.ts` (`getLiveMessages`, `getLiveMessagesWithId`, `getOperatorInstructionsAfter`, `getAllMessages`) · `archive-prefix.ts` (`ArchivePrefixPlan`, `selectArchivePrefix` — pure logic). Façade re-exports all 15.
**Non-test importers (untouched, 14):** `engine/checkpoint/prefix.ts`, `engine/compact-jobs/service.ts`, `engine/core/{operator-instructions,recall-seed,hydrate,tool-output-overflow,turn-loop-post-compact,turn-loop,turn,turn-loop-text-response,turn-loop-tool-batch}.ts`, `engine/events/{append-transcript,transcript-bus}.ts`, `engine/wake/blob-refresh.ts`.
**Invariant guards (runnable):** `db/repos/messages.test.ts`, `db/repos/messages-archive-column-parity.test.ts`, `db/repos/messages-prefix.test.ts`, `engine/core/hydrate.test.ts`, `engine/ingress.test.ts`.
**Invariant:** column lists byte-identical (archive-column-parity guard); `selectArchivePrefix` logic unchanged; live/all/operator-instruction queries unchanged.

---

## Verification protocol (owned by main Claude)
1. root `tsc --noEmit` (A-011/012 + src). 2. `vex-app lint` (A-009/010 + boundary check). 3. single-process vitest both projects over the runnable guard suites + 4 surface tests (EXCLUDE `.int.test.ts` real-DB suites; note them). 4. git scope: only 4 façades modified + 4 new dirs/sibling-sets + 4 surface tests; zero importers (incl. `session-memories/index.ts`). 5. Codex final-review → commit per-item → FF push.

## Open questions for Codex (plan-review gate)
1. Hidden coupling / cycle risk — esp. A-012's shared row-mapper + `MESSAGE_DB_COLUMNS` used by read/write; A-011's `prepareMemoryRender→insertPreparedMemory` chain and any shared private helper across crud functions; A-009's redaction/sanitize shared by list/tail/around.
2. A-009: is the secret-word redaction / tool-arg sanitizing cleanly extractable without altering what gets redacted? Any import of the diagnostics/bug-report redaction schema to preserve?
3. A-011: given the deep guards are real-DB integration tests not run here, is a verbatim structural move + façade + surface + `body-md-hash` + tsc sufficient, or is there a specific branch I must pin with a unit test before cutting?
4. `shared/schemas/messages.ts` importing `messages-db` — real import (process-boundary concern) or comment? Anything to preserve.
5. Anything to serialize, or additional guard to pin.
