---
id: module.src-root.lib-db-utilities
kind: module
paths:
  - "src/lib/db/migrate-runner.ts"
  - "src/utils/logger.ts"
  - "src/utils/logger-shim.ts"
  - "src/utils/http.ts"
  - "src/utils/package-assets.ts"
  - "src/utils/validation-helpers.ts"
  - "src/utils/rateLimit.ts"
  - "src/utils/canonicalJson.ts"
  - "src/utils/minimatch.ts"
  - "src/utils/output.ts"
  - "src/errors.ts"
source_commit: 152af27
indexed_at: 2026-05-28
stale_when_paths_change:
  - "src/lib/db/migrate-runner.ts"
  - "src/utils/logger.ts"
  - "src/utils/logger-shim.ts"
  - "src/utils/http.ts"
  - "src/utils/package-assets.ts"
  - "src/utils/validation-helpers.ts"
  - "src/utils/rateLimit.ts"
  - "src/utils/canonicalJson.ts"
  - "src/utils/minimatch.ts"
  - "src/utils/output.ts"
  - "src/errors.ts"
related:
  - module.vex-agent.data-memory-knowledge
  - module.src-root.lib-env-config
  - module.src-root.lib-diagnostics
---

# src-root lib-db-utilities

Z5 shared infrastructure: the advisory-locked migration runner, structured logging
(winston and its cross-boundary shim), HTTP fetch, package-asset path resolution,
API validation helpers, concurrency primitives, canonical JSON, glob matching, CLI
output helpers, and the root `VexError` + `ErrorCodes` vocabulary used across the
entire repo.

## Purpose

This module groups the foundational, dependency-light primitives that every other
zone in the monorepo imports directly or via tsconfig aliases (`@utils/*`, `@vex-lib/db/*`).
Its defining constraint: every utility here must remain importable from both the
engine (Z4/Z3, Node full) AND the vex-app main process (Z6, Electron, imported via
`@vex-lib` alias). The one exception is `logger.ts` (winston + side-effecting OS
deps) which is deliberately kept out of all cross-boundary paths; `logger-shim.ts`
is the safe cross-boundary substitute.

Out of scope: `utils/dotenv.ts` + `utils/env.ts` (covered by
`module.src-root.lib-env-config`); `lib/diagnostics/` (covered by
`module.src-root.lib-diagnostics`).

## Retrieval keywords

- migrate-runner, advisory lock, pg_advisory_lock, schema_version, migrations
- MigrationError, MigrationProgressEvent, runMigrationsWithProgress
- logger, winston, createChildLogger, LOG_LEVEL, LOG_FORMAT
- logger-shim, MinLogger, minLogger, cross-boundary logging, renderer-safe logger
- fetchWithTimeout, parseJsonResponse, fetchJson, readJson, HTTP_TIMEOUT
- package-assets, getVexAgentMigrationsDir, resolveRequiredPath, getPackageRoot
- validation-helpers, createFieldValidators, isRecord
- TokenBucket, ConcurrencyLimiter, rate limiting
- canonicalJson, canonical JSON, key-sorted JSON
- minimatch, glob matching, globToRegex
- output.ts, writeStdout, writeStderr, writeJson, writeJsonError, isHeadless
- VexError, ErrorCodes, ErrorCode, error codes, error vocabulary

## State owned

### In-memory
- `output.ts`: module-level `jsonModeEnabled` boolean (mutated by `setJsonMode`).
- `logger.ts`: singleton `winston.Logger` at module scope.
- `logger-shim.ts`: `debugEnabled` boolean derived from `LOG_LEVEL` at import time.
- `package-assets.ts`: `PACKAGE_ROOT` constant derived at module load.

### ENV vars consumed
| Var | File | Effect |
|-----|------|--------|
| `LOG_LEVEL` | `logger.ts`, `logger-shim.ts` | Winston log level (default `"info"`); shim debug gate |
| `LOG_FORMAT` | `logger.ts` | `"json"` → structured; `"pretty"` → colorized; absent → TTY detect |

### No DB tables, no filesystem writes, no persistent state.

## Boundary crossings

### `src/lib/db/migrate-runner.ts`
- **Postgres advisory lock**: `pg_advisory_lock(1985229328)` held for the entire
  migration run on a dedicated pooled client. This is the load-bearing concurrency
  primitive — it serializes all callers (Z6 IPC bootstrap, Z4 engine entrypoint,
  integration-test globalSetup) against the same Postgres instance.
- **Filesystem reads**: `readdirSync` + `readFileSync` on `migrationsDir` to list
  and load `.sql` files. Both the engine path (`src/vex-agent/db/migrations/`) and
  the packaged Electron path (`process.resourcesPath/migrations`) work with the same
  runner; callers provide `migrationsDir` at call time.
- **Pool ownership**: the runner accepts an externally-created `pg.Pool`, does NOT
  create one itself. Z6 wrapper creates a `max:1` pool dedicated to the migrate call
  and calls `pool.end()` in its `finally`. Z4 engine passes the shared engine pool.

### `src/utils/logger.ts`
- Writes to `process.stderr` exclusively (stdout reserved for machine-readable output).
- Imports `winston` which transitively imports `@colors/colors` whose
  `supports-colors.js` calls `os.release()` at module init. This side effect makes
  `logger.ts` **NOT safe to import from vex-app renderer or from any module bundled
  via `@vex-lib`** — the Vite browser stub for `os` crashes at startup on Windows.
  See `logger-shim.ts` for the cross-boundary safe alternative.

### `src/utils/http.ts`
- Uses the Web `fetch` global (present in Node 18+, Electron, and browsers).
- Wraps every call with `AbortController` + `setTimeout` — callers must ensure
  the timeout ID is cleared (done internally in `finally`).

### `src/utils/output.ts`
- Writes directly to `process.stdout` / `process.stderr`. CLI/MCP-layer only.
- Not imported by the engine (Z1–Z4) or vex-app (Z6–Z8); used by root CLI scripts.

## File map

- `src/lib/db/migrate-runner.ts:26 VEX_MIGRATE_LOCK_ID` — bigint `1_985_229_328`;
  pinned value shared across all callers; changes here break concurrent callers.
  `:36 MigrationError` — typed error preserving `version`, `file`, `cause` for
  IPC surfacing without log parsing.
  `:51 MigrationProgressEvent` — `planned | start | applied` phases; `total` only
  meaningful on `planned`.
  `:136 runMigrationsWithProgress` — main export; advisory-lock acquire → list
  pending → apply each in its own transaction → advisory-lock release → `RESET ALL`.

- `src/utils/logger.ts:28 logger` — winston singleton; `defaultMeta.service="vex-agent"`;
  format: JSON if `LOG_FORMAT=json` or non-TTY stderr, colorized otherwise.
  `:42 createChildLogger` — thin wrapper over `logger.child(meta)`; filters `undefined`
  values before passing to winston.

- `src/utils/logger-shim.ts:28 MinLogger` — interface (`debug | warn | error`).
  `:47 minLogger` — implementation; `debug` gated on `LOG_LEVEL=debug`; all output
  to `process.stderr`; no external imports; safe for cross-boundary use.

- `src/utils/http.ts:16 fetchWithTimeout` — wraps `fetch` with `AbortController`
  timeout (default 30 s); AbortError → `VexError(HTTP_TIMEOUT)`, other errors →
  `VexError(HTTP_REQUEST_FAILED)`.
  `:52 parseJsonResponse` — checks `response.ok`, attempts to extract `errorBody.error`
  on failure; casts result to `T` (no runtime schema validation).
  `:79 fetchJson` — `fetchWithTimeout` + `parseJsonResponse` composed.
  `:91 readJson` — safe JSON read that returns `null` on parse failure (for error-body
  inspection before mapping).

- `src/utils/package-assets.ts:7 getPackageRoot` — derived at module load via
  `import.meta.url`; two levels up from `src/utils/`.
  `:11 resolveRequiredPath` — first-match resolver across candidate paths; throws
  descriptive error listing all candidates on miss.
  `:28 getVexAgentMigrationsDir` — resolves `dist/vex-agent/db/migrations` (prod)
  or `src/vex-agent/db/migrations` (dev); used by the Z4 engine migrate entrypoint.

- `src/utils/validation-helpers.ts:11 isRecord` — type-guard for non-null, non-array
  object; used to narrow `unknown` API responses before field access.
  `:28 createFieldValidators` — factory returning `{asString, asNumber,
  asOptionalString, asOptionalNumber, asStringArray}`; each validator throws
  `VexError(errorCode, ...)` on failure; `errorCode` and `prefix` are bound at
  factory call time to the owning API client.

- `src/utils/rateLimit.ts:7 TokenBucket` — token-bucket rate limiter (tokens per
  second); `acquire()` is async, blocks via `setTimeout` if token-starved; mutable
  `tokens`/`lastRefill` state (not thread-safe in a worker model, but safe for
  single-threaded Node/Electron main).
  `:42 ConcurrencyLimiter` — FIFO concurrency cap; `acquire()` enqueues a resolver
  when at capacity; caller MUST call `release()` in `finally`.

- `src/utils/canonicalJson.ts:6 canonicalJson` — recursive key-sorting
  `JSON.stringify` replacer; used for deterministic hash computation (query signing,
  content-hash stability).

- `src/utils/minimatch.ts:6 minimatch` — homegrown glob-to-regex converter; supports
  `*` (no `/`), `?`, `**` (any path). Does NOT support brace expansion or negation.
  Note: actual consumers not found in current tree; may be retained for future use.

- `src/utils/output.ts:11 setJsonMode` — flips `jsonModeEnabled` module flag.
  `:19 isHeadless` — `jsonModeEnabled || !isStderrTTY()`.
  `:47 writeJson` — writes JSON-serialized data to stdout.
  `:59 writeJsonError` — writes `{success:false, error:{code,message,...}}`.
  `:72 writeJsonSuccess` — writes `{success:true, ...data}`.
  Used by root CLI/MCP scripts; no engine or vex-app consumers in current tree.

- `src/errors.ts:4 VexError` — `Error` subclass with `code: string`, `hint?: string`,
  `retryable?: boolean`, `externalName?: string`. `name="VexError"` for reliable
  `instanceof` + name-check identification across module graph.
  `:21 ErrorCodes` — `as const` object (~120 string literal codes across 14
  categories). See section below.
  `:242 ErrorCode` — union type derived via `(typeof ErrorCodes)[keyof typeof ErrorCodes]`.

## Key types and invariants

- `VexError` (`src/errors.ts:4`) — the repo-wide structured error type. `code` is
  always a string from `ErrorCodes`; `hint` is human-facing mitigation text safe to
  surface to users; `retryable`/`externalName` are optional decorators used by IPC
  result mapping and API error classification. Catching code MUST check
  `err instanceof VexError` before accessing `.code`.

- `ErrorCodes` categories (do NOT enumerate every code; read from source):
  - **Wallet & Config**: keystore, inventory, wallet selection, insufficient balance,
    intents, address/amount validation, RPC, signer, password.
  - **Agent daemon/runtime**: start/stop, validation, inference, tool execution,
    compaction, approval, scheduler, backup/restore, external service.
  - **HTTP**: `HTTP_REQUEST_FAILED`, `HTTP_TIMEOUT`.
  - **Protocol clients** (Khalani, KyberSwap aggregator/token/limit-order/ZaaS,
    Polymarket): each protocol has its own `_API_ERROR`, `_TIMEOUT`,
    `_RATE_LIMITED`, and domain-specific failure codes.
  - **Setup/onboarding**: setup target, link, source, system check, connector write.
  - **CLI/tooling**: bot, update-daemon, guardrails, onboard, launcher.
  - **Solana**: address, balance, transfer, tx, token, RPC, quote/swap/stake/order,
    Jupiter portfolio/lend/send/prediction/studio, LP, DexScreener.
  - **Openclaw / Claude proxy / backup**: each domain-isolated.

- `MigrationError` (`src/lib/db/migrate-runner.ts:36`) — carries `version: number`,
  `file: string`, `cause: unknown`. IPC handler catches this specifically to produce
  a `failedAt` field without parsing log strings.

- `MigrationProgressEvent` (`src/lib/db/migrate-runner.ts:51`) — three phases:
  `planned` (total = pending count; version/file = 0/""), `start` (before SQL),
  `applied` (after commit). Consumers (Z6 IPC progress bus) relay these events to
  the renderer migration screen.

- `MinLogger` (`src/utils/logger-shim.ts:28`) — minimal contract for cross-boundary
  loggers. Wallet/config primitives imported via `@vex-lib` type this dependency as
  `MinLogger` to remain decoupled from winston.

- `TokenBucket` (`src/utils/rateLimit.ts:7`) — stateful per-instance; not shared
  across call sites. `acquire()` is `async` — callers must `await` it.

- `ConcurrencyLimiter` (`src/utils/rateLimit.ts:42`) — FIFO queue, not fair under
  high load. Requires explicit `release()` — missing `release()` in error paths will
  deadlock all queued callers.

## Capabilities (stable IDs)

- **CAP-db-migrate-advisory-lock**: Serialize concurrent migration runs via
  Postgres advisory lock `1985229328`; each migration in its own transaction;
  per-statement timeout configurable.
  — `src/lib/db/migrate-runner.ts:136 runMigrationsWithProgress`

- **CAP-db-migrate-error-typed**: Surface failing migration file/version without
  log parsing via `MigrationError`.
  — `src/lib/db/migrate-runner.ts:36 MigrationError`

- **CAP-db-migrate-progress**: Emit `planned | start | applied` events to let callers
  drive progress UI.
  — `src/lib/db/migrate-runner.ts:51 MigrationProgressEvent`

- **CAP-util-log-structured**: Winston structured logger to stderr; JSON or colorized
  based on TTY/env; child loggers with bound metadata.
  — `src/utils/logger.ts:28 logger`, `:42 createChildLogger`

- **CAP-util-log-shim**: Dependency-free `MinLogger` shim for cross-boundary code
  where winston cannot be imported (Vite/Electron renderer/main boundary safety).
  — `src/utils/logger-shim.ts:47 minLogger`

- **CAP-util-http-timeout**: `fetch` with `AbortController` timeout; typed
  `VexError` on timeout or network failure.
  — `src/utils/http.ts:16 fetchWithTimeout`

- **CAP-util-http-json**: Composed fetch + JSON parse with HTTP error extraction.
  — `src/utils/http.ts:79 fetchJson`, `:52 parseJsonResponse`, `:91 readJson`

- **CAP-util-package-asset-path**: Runtime-safe path resolution for packaged vs dev
  assets; throws descriptive error listing all candidates on miss.
  — `src/utils/package-assets.ts:28 getVexAgentMigrationsDir`

- **CAP-util-validation-factory**: Domain-scoped field validators from a single
  factory; throw `VexError(domainCode, ...)` on invalid fields.
  — `src/utils/validation-helpers.ts:28 createFieldValidators`

- **CAP-util-is-record**: Type guard for non-null objects before field access.
  — `src/utils/validation-helpers.ts:11 isRecord`

- **CAP-util-rate-limit-token-bucket**: Token-bucket rate limiter (async, per instance).
  — `src/utils/rateLimit.ts:7 TokenBucket`

- **CAP-util-rate-limit-concurrency**: FIFO concurrency cap with explicit release.
  — `src/utils/rateLimit.ts:42 ConcurrencyLimiter`

- **CAP-util-canonical-json**: Deterministic key-sorted JSON serialization for hashing
  and signing.
  — `src/utils/canonicalJson.ts:6 canonicalJson`

- **CAP-util-glob-match**: Minimal glob pattern matching (`*`, `?`, `**`).
  — `src/utils/minimatch.ts:6 minimatch`

- **CAP-util-cli-output**: stdout/stderr separation + JSON output envelopes for CLI
  and MCP scripts.
  — `src/utils/output.ts:11 setJsonMode`, `:47 writeJson`, `:59 writeJsonError`

- **CAP-util-vex-error**: Structured error with typed `code`, user-facing `hint`,
  and optional `retryable`/`externalName` decorators.
  — `src/errors.ts:4 VexError`, `:21 ErrorCodes`

## Public API (consumed by)

### CAP-db-migrate-advisory-lock / CAP-db-migrate-error-typed / CAP-db-migrate-progress

- `src/vex-agent/db/migrate.ts:21 runMigrations` — Z4 engine entrypoint; passes
  engine `getPool()` + `getVexAgentMigrationsDir()`.
- `vex-app/src/main/database/migrate-runner.ts:87 runMigrationsForIpc` — Z6 IPC
  wrapper; creates a dedicated `max:1` pool, tears it down via `pool.end()` in
  `finally`, emits progress to `migrationProgressBus`. Catches `MigrationError`
  to produce `{ kind:"failed", failedAt }`.
- `vex-app/src/main/ipc/database.ts:26` — IPC handler calling `runMigrationsForIpc`.
- Test infrastructure: `vex-app/src/main/database/__tests__/migrate-runner.test.ts`.

### CAP-util-log-structured (logger.ts — NOT cross-boundary)

- `src/vex-agent/**` — pervasive: every engine zone uses `@utils/logger`.
- `src/tools/**` — protocol clients.
- NOT imported by `vex-app/src/**` or any module under `@vex-lib` alias.

### CAP-util-log-shim (logger-shim.ts — cross-boundary safe)

- `src/config/store.ts` — config.json reader/writer.
- `src/tools/wallet/keystore.ts` — EVM keystore operations.
- `src/tools/wallet/client.ts` — wallet signing client.
- `src/tools/wallet/backup.ts` — wallet backup.
- `src/lib/wallet-backup.ts` — shared wallet-backup library.
- All above are imported via `@vex-lib/wallet` in vex-app main (Z6).

### CAP-util-http-timeout / CAP-util-http-json (http.ts)

- `src/tools/polymarket/{relayer,gamma,clob,data,bridge}/client.ts` — all five
  Polymarket API clients.
- `src/tools/wallet/polymarket-credentials.ts` — CLOB credential derivation.
- NOT imported by vex-app main or renderer (those use native fetch directly).

### CAP-util-package-asset-path (package-assets.ts)

- `src/vex-agent/db/migrate.ts:19` — sole consumer of `getVexAgentMigrationsDir`.

### CAP-util-validation-factory (validation-helpers.ts)

- `src/tools/polymarket/{clob,gamma,data}/validation.ts` — Polymarket API validators.
- `src/tools/khalani/validation.ts` — Khalani API validator.
- `src/tools/kyberswap/{common,token-api,limit-order,aggregator}/validation.ts`
  — KyberSwap validators.

### CAP-util-vex-error (errors.ts)

- `src/utils/http.ts` — throws `VexError(HTTP_TIMEOUT / HTTP_REQUEST_FAILED)`.
- `src/utils/validation-helpers.ts` — throws `VexError(domainCode)`.
- `src/tools/**` — all protocol clients and wallet tools.
- `src/vex-agent/**` — engine zones.
- `vex-app/src/main/**` — IPC error mapping uses `VexError` subclasses or codes.
- `vex-app/src/shared/ipc/result.ts` — defines the IPC error envelope
  (`VexError` shape is mirrored but not the same class across process boundaries).

### CAP-util-rate-limit-token-bucket / CAP-util-rate-limit-concurrency (rateLimit.ts)

- `src/__tests__/utils/rateLimit.test.ts` — unit tests only.
- Noted as KyberSwap dependency in `src/tools/TOOLS.md` but no active import found
  in KyberSwap source at this commit — may have been a planned or removed usage.

### CAP-util-canonical-json (canonicalJson.ts)

- No consumers found outside `src/utils/canonicalJson.ts` itself at this commit.
  Retained as infrastructure; may be used by signing code outside the indexed scope.

### CAP-util-glob-match (minimatch.ts)

- No consumers found outside `src/utils/minimatch.ts` at this commit. The function
  name shadows the npm `minimatch` package; future knowledge/tool-path filtering
  may adopt this when the npm dep is not desirable.

### CAP-util-cli-output (output.ts)

- No consumers found in engine (Z1–Z4) or vex-app (Z6–Z8) at this commit.
  Used by root CLI and MCP scripts outside the indexed scope (e.g. wallet CLI
  commands, knowledge-import scripts).

## Internal flow

### Advisory-lock migration protocol (`runMigrationsWithProgress`)

```
pool.connect() → dedicated PoolClient
  SET lock_timeout = ${lockTimeoutMs}           # fail fast if another runner holds
  SELECT pg_advisory_lock(1985229328)            # session-level, auto-released on disconnect
  lockAcquired = true
  SET statement_timeout = ${statementTimeoutMs}  # per-statement, set AFTER lock
  CREATE TABLE IF NOT EXISTS schema_version
  SELECT MAX(version) FROM schema_version        # → currentVersion
  readdirSync(migrationsDir).filter(*.sql, /^\d{3}_/)
    .sort().filter(version > currentVersion)     # → pending list
  onProgress({phase:"planned", total:N})
  for each pending:
    onProgress({phase:"start", ...})
    BEGIN
      execute migration SQL
      INSERT INTO schema_version(version)
    COMMIT                                       # MigrationError on failure → ROLLBACK
    onProgress({phase:"applied", ...})
finally:
  pg_advisory_unlock(1985229328)                 # best-effort; if fails → client.release(error)
  RESET ALL                                      # restore session defaults for pooled client
  client.release() or client.release(Error)     # destroy client if unlock failed (prevents deadlock)
```

**Key invariant**: `RESET ALL` does NOT release advisory locks (session-level, not
transaction-level). The explicit `pg_advisory_unlock` call is mandatory. If
`pg_advisory_unlock` fails, the client is destroyed (not returned to pool) to
prevent the next pool consumer from inheriting a locked session. This is the
load-bearing deadlock-prevention step.

**Timeout layering**:
- `lock_timeout` set BEFORE advisory lock → prevents infinite blocking if another
  run is in progress.
- `statement_timeout` set AFTER lock → caps individual SQL statement duration (e.g.
  a slow `CREATE INDEX`) without capping the lock acquisition itself.

### HTTP fetch with timeout (`fetchWithTimeout`)

```
AbortController + setTimeout(timeoutMs)
  fetch(url, { ...options, signal })
    success → clear timeout → return Response
    AbortError → clear timeout → throw VexError(HTTP_TIMEOUT)
    other → clear timeout → throw VexError(HTTP_REQUEST_FAILED)
  // timeout fires → controller.abort() → AbortError path
```

## Dependencies

### Imports FROM

- `pg` (npm) — `migrate-runner.ts` uses `pg.PoolClient` type only (type import); no
  runtime pg import in this file; pool is passed by caller.
- `winston` (npm) — `logger.ts` only. Side-effecting at module load.
- `node:fs` (stdlib) — `migrate-runner.ts` (`readdirSync`, `readFileSync`).
- `node:path` (stdlib) — `migrate-runner.ts`, `package-assets.ts`.
- `node:url` (stdlib) — `package-assets.ts` (`fileURLToPath`).
- `node:stream` (stdlib) — `logger.ts`, `logger-shim.ts` (type import only).
- `src/errors.ts` — `http.ts`, `validation-helpers.ts` (VexError, ErrorCodes).

### Consumed BY

- `module.vex-agent.data-memory-knowledge` (Z4) — `migrate-runner.ts` via
  `src/vex-agent/db/migrate.ts`; `logger.ts` and `package-assets.ts` throughout.
- `module.vex-agent.engine-core` (Z1) — `logger.ts`, `VexError`.
- `module.vex-agent.inference` (Z3) — `logger.ts`, `VexError`, `http.ts`.
- `module.vex-agent.tools-internal` (Z3) — `logger.ts`, `VexError`.
- `module.vex-agent.tools-protocols` (Z3) — `http.ts`, `validation-helpers.ts`,
  `rateLimit.ts` (referenced), `logger.ts`, `VexError`.
- `vex-app main (Z6)` — `migrate-runner.ts` via `@vex-lib/db/migrate-runner.js`;
  `VexError`/`ErrorCodes` in IPC handlers.
- `vex-app shared (Z7)` — `VexError`/`ErrorCodes` shape mirrored in
  `shared/ipc/result.ts` (independent definition, not a cross-process import).
- `src/config/store.ts`, `src/tools/wallet/**`, `src/lib/wallet-backup.ts` —
  `logger-shim.ts` (cross-boundary safe logger).

## Cross-references

- vex-app coverage: `audits/current/coverage-gaps.md#CAP-db-migrate-advisory-lock`
- quality findings: `audits/current/quality-findings.md`
- related modules: `module.vex-agent.data-memory-knowledge` (primary migrate-runner
  consumer via `src/vex-agent/db/migrate.ts`)
- related modules: `module.src-root.lib-env-config` (out-of-scope sibling:
  `utils/env.ts` `getKeystorePassword`/`requireKeystorePassword`)
- related modules: `module.src-root.lib-diagnostics` (out-of-scope sibling:
  `lib/diagnostics/text-redaction.ts` etc.)
- related decisions: `decisions/ADR-0001-global-model-session-wallet.md`

## Refresh triggers

This doc is stale when any file in `paths` changes. Highest-priority triggers:

- `src/lib/db/migrate-runner.ts` — advisory lock ID change, timeout default change,
  new progress phases, pool-lifecycle change.
- `src/errors.ts` — new error category, new `ErrorCodes` entry, `VexError` field
  change.
- `src/utils/logger.ts` or `logger-shim.ts` — transport change, shim interface
  change, boundary safety change.
- `src/utils/http.ts` — default timeout change, new exported function.

## Open questions

- `src/utils/canonicalJson.ts` has no active consumers in Z1–Z8 at this commit.
  Confirm whether it is used by a root CLI/script outside the indexed scope (e.g.
  wallet signing, query signing) or can be removed.
- `src/utils/minimatch.ts` similarly has no active consumers in Z1–Z8. Confirm
  intended use case or remove.
- `src/utils/rateLimit.ts` is listed in `src/tools/TOOLS.md` as a KyberSwap
  dependency but no `import` statement found in KyberSwap source. Either the doc is
  stale or the import is in a file outside the indexed scope. Verify.
- `parseJsonResponse` in `http.ts` casts the parsed JSON to `T` without schema
  validation (`return (await response.json()) as T`). All callers that pass untrusted
  external data should validate the result with Zod rather than relying on the cast.
  This is a latent type-safety gap (rule: TS §2, treat external input as `unknown`).
- `logger.ts` does not accept a `correlationId` at logger creation time; callers
  must pass it via `createChildLogger`. Consider whether a request/session-scoped
  logger factory pattern is warranted as call-site proliferation grows.
