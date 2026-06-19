### 2.6 Work Unit 6 — Local database and migrations

#### Files & LOC

- `src/vex-agent/db/client.ts` 149 LOC
- `src/vex-agent/db/params.ts` 153 LOC
- `src/vex-agent/db/migrations/001_initial.sql` 504 LOC — **god-file/refactor candidate**
- `src/vex-agent/db/migrations/016_session_memories.sql` 140 LOC
- `src/vex-agent/db/migrations/021_sessions_deleted_at.sql` 20 LOC
- `src/vex-agent/db/migrations/029_swap_prequotes.sql` 97 LOC
- `src/vex-agent/db/migrations/031_session_plans.sql` 36 LOC
- `vex-app/resources/migrations/029_swap_prequotes.sql` 85 LOC
- `src/lib/db/migrate-runner.ts` 236 LOC
- `vex-app/src/main/database/migrate-runner.ts` 138 LOC
- `vex-app/src/main/database/sessions-db.ts` 684 LOC — **god-file/refactor candidate**
- `vex-app/src/main/database/messages-db.ts` 558 LOC — **god-file/refactor candidate**
- `vex-app/src/main/database/mission-runs-db.ts` 289 LOC
- `vex-app/src/main/database/bug-reports-db.ts` 447 LOC — **god-file/refactor candidate**
- `src/vex-agent/db/repos/session-memories/crud.ts` 465 LOC — **god-file/refactor candidate**
- `src/vex-agent/db/repos/search.ts` 75 LOC
- `src/vex-agent/db/repos/recall-cache.ts` 156 LOC
- `src/vex-agent/db/repos/tool-output-blobs.ts` 172 LOC
- `src/vex-agent/db/repos/knowledge.ts` 24 LOC

#### Responsibility

- `client.ts`: shared `pg.Pool`, query helpers, transaction helper, pool cleanup.
- `params.ts`: DB JSON/JSONB parameter sanitization.
- migrations: local Postgres/pgvector schema.
- `migrate-runner.ts`: advisory-lock migration runner.
- Electron DB repos: main-side DTO/session/message/report repositories.
- Agent DB repos: runtime persistence for sessions, messages, approvals, memories, captures, sync, projections, caches.

#### Mechanisms/patterns

- Advisory lock migration serialization.
- Per-migration transaction.
- Statement timeout.
- Rollback on failure.
- Explicit executor/transaction injection.
- JSONB parameter safety checks.
- Typmod-free pgvector with `embedding_model`, `embedding_dim`, and dimension checks.
- Soft delete via `sessions.deleted_at`.
- Cascades on hard session deletion for many session-owned tables.
- TTL/lazy cleanup for some caches.

#### Dependencies & data-flow

Entry points:

- Main database IPC triggers migrations.
- Compose success sets DB connection state.
- Agent runtime uses DB repos directly for engine/session/tool state.
- Renderer queries main DB DTO handlers.

Imports/dependencies:

- Main DB repos depend on main connection state/pool config.
- Agent DB repos depend on `src/vex-agent/db/client.ts`.
- Migration copy/build scripts mirror canonical migrations into app resources.

Side effects:

- Opens Postgres pool.
- Runs SQL migrations.
- Writes/reads local user-sensitive data.
- Stores vectors, transcript content, tool outputs, protocol executions, approvals, wallet intents, bug reports.

#### Security surface

- Local DB contains sensitive user content, memory, tool output, wallet/protocol identifiers, approval data, and support reports.
- DB URL/password must stay main/runtime only.
- `src/vex-agent/db/client.ts` has a fallback DB URL with static credentials and logs that URL in fallback mode.
- Migration mirror drift can package wrong schema semantics.

#### Hotspots

- Confirmed drift:
  - `src/vex-agent/db/migrations/029_swap_prequotes.sql`
  - `vex-app/resources/migrations/029_swap_prequotes.sql`
- `001_initial.sql` 504 LOC is broad and hard to scan.
- Main DB repos `sessions-db.ts`, `messages-db.ts`, `bug-reports-db.ts` are large.
- `src/vex-agent/db/repos/knowledge.ts` facade shares basename with `src/vex-agent/db/repos/knowledge/`, which can confuse imports.
- Soft delete does not establish full erasure semantics for caches/captures/tool blobs/support/vault/backups.

`console.*` density:

- DB runtime logging uses logger utilities; fallback URL warning is the key redaction risk rather than console density.

#### Tests

Covered:

- Migration runner tests in main and shared lib.
- DB/repo tests under `src/__tests__/vex-agent/db/**`.
- Integration tests under `src/__tests__/integration/**`.
- Renderer database migration screen tests.
- Build artifact gate checks migration mirror integrity.

Not covered / unclear:

- Full deletion/erasure semantics.
- Stale running sync row recovery.
- Support bundle DB redaction proof.
- Current migration drift would likely fail packaged build checks but was not fixed.

#### Open risks/smells

- Fix `029_swap_prequotes.sql` drift.
- Remove or redact fallback DB URL logging.
- Define erasure semantics for soft-deleted sessions and caches.
- Split large main DB repos by query responsibility.
- Audit bug report DB for sensitive content retention.

