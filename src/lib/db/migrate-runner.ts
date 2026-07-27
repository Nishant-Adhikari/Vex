/**
 * Shared Postgres migration runner — used by both the Vex Agent
 * (legacy entrypoint via src/vex-agent/db/migrate.ts) and the Electron
 * app (src/main/database/migrate-runner.ts which adds IPC plumbing).
 *
 * Lives under src/lib/ so it has zero root path-alias dependencies
 * (`@utils/...`, etc.). Vex-app's main tsconfig only includes
 * `vex-app/src/**` plus this `src/lib/**` carve-out, so importing
 * across the boundary stays build-safe.
 *
 * Concurrency safety: a Postgres advisory lock guards the whole run.
 * Concurrent processes (Electron main, maintenance scripts, integration
 * tests) are serialized — only one applies
 * migrations at a time.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type pg from "pg";

/**
 * Stable advisory-lock identifier shared across every Vex consumer.
 * Pinning a single bigint lets concurrent installs/scripts queue on the
 * same lock instead of silently racing on schema_version.
 */
const VEX_MIGRATE_LOCK_ID = 1_985_229_328;

const DEFAULT_STATEMENT_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_LOCK_TIMEOUT_MS = 30_000;

/**
 * Thrown when a single migration's SQL execution fails. Preserves the
 * version/file context so callers (the IPC handler especially) can
 * surface `failedAt` without parsing log lines.
 */
export class MigrationError extends Error {
  public readonly version: number;
  public readonly file: string;
  // `override`: Error.cause exists in lib ES2022+; vex-app's typecheck
  // profile (noImplicitOverride) requires the modifier to be explicit.
  public override readonly cause: unknown;

  constructor(version: number, file: string, cause: unknown) {
    const causeMsg = cause instanceof Error ? cause.message : String(cause);
    super(`Migration ${file} (v${version}) failed: ${causeMsg}`);
    this.name = "MigrationError";
    this.version = version;
    this.file = file;
    this.cause = cause;
  }
}

export interface MigrationProgressEvent {
  /**
   * - `planned`: emitted once at the start with `total` set to the count
   *   of pending migrations. `version` and `file` are unused (0 / "").
   * - `start`: emitted before each migration's SQL execution.
   * - `applied`: emitted after the migration commits successfully.
   */
  readonly phase: "planned" | "start" | "applied";
  readonly index: number;
  readonly total: number;
  readonly version: number;
  readonly file: string;
}

export interface RunMigrationsOptions {
  readonly pool: pg.Pool;
  readonly migrationsDir: string;
  readonly onProgress?: (event: MigrationProgressEvent) => void;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
}

export interface RunMigrationsResult {
  readonly applied: number;
  readonly files: ReadonlyArray<string>;
}

interface PendingMigration {
  readonly version: number;
  readonly file: string;
}

function listPendingMigrations(
  migrationsDir: string,
  currentVersion: number
): ReadonlyArray<PendingMigration> {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && /^\d{3}_/.test(f))
    .sort()
    .map((file) => ({ version: parseInt(file.slice(0, 3), 10), file }))
    .filter((m) => m.version > currentVersion);
}

async function readCurrentVersion(client: pg.PoolClient): Promise<number> {
  const result = await client.query<{ version: number }>(
    "SELECT COALESCE(MAX(version), 0) AS version FROM schema_version"
  );
  return result.rows[0]?.version ?? 0;
}

async function ensureSchemaVersionTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function applyMigration(
  client: pg.PoolClient,
  migration: PendingMigration,
  migrationsDir: string
): Promise<void> {
  const sql = readFileSync(path.join(migrationsDir, migration.file), "utf-8");
  try {
    await client.query("BEGIN");
    await client.query(sql);
    await client.query(
      "INSERT INTO schema_version (version) VALUES ($1)",
      [migration.version]
    );
    await client.query("COMMIT");
  } catch (cause: unknown) {
    // ROLLBACK is best-effort — if the connection itself died we cannot
    // do anything sensible; the throw below carries the original cause.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw new MigrationError(migration.version, migration.file, cause);
  }
}

/**
 * Release a client used for a lock-guarded migration/heal pass. Unlocks
 * the advisory lock (best-effort), resets session settings, and returns
 * the client to the pool — force-destroying it if the unlock failed so a
 * still-locked connection can't poison future runs.
 *
 * NOTE `RESET ALL` does NOT release session-level advisory locks — only
 * `pg_advisory_unlock` or session disconnect does.
 */
async function releaseMigrationClient(
  client: pg.PoolClient,
  lockAcquired: boolean
): Promise<void> {
  let unlockFailed = false;
  if (lockAcquired) {
    // Best-effort unlock — if the session is dying the lock is auto-
    // released when the connection closes anyway.
    try {
      await client.query("SELECT pg_advisory_unlock($1::bigint)", [
        VEX_MIGRATE_LOCK_ID,
      ]);
    } catch {
      unlockFailed = true;
    }
  }
  // Reset session settings so the next consumer of this pooled client
  // (engine refactor passes a shared pool) gets defaults.
  try {
    await client.query("RESET ALL");
  } catch {
    /* ignore */
  }
  if (unlockFailed) {
    // The session may still hold the advisory lock. Returning the client
    // to the pool would let the next consumer re-acquire its own
    // connection that already owns the lock, deadlocking every future
    // migrate run. Force-destroy by passing a truthy arg so pg-pool
    // removes this client from the pool (codex turn 2 should-fix #5).
    client.release(
      new Error("migrate-runner: pg_advisory_unlock failed; destroying client")
    );
  } else {
    client.release();
  }
}

export async function runMigrationsWithProgress(
  options: RunMigrationsOptions
): Promise<RunMigrationsResult> {
  const statementTimeoutMs =
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;

  const client = await options.pool.connect();
  let lockAcquired = false;
  try {
    // lock_timeout governs both relation locks AND advisory lock acquisition.
    // Set BEFORE asking for the lock so we fail fast instead of blocking
    // forever behind another in-flight migration.
    await client.query(`SET lock_timeout = ${lockTimeoutMs}`);
    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      VEX_MIGRATE_LOCK_ID,
    ]);
    lockAcquired = true;

    // statement_timeout caps each individual SQL statement (e.g. a
    // CREATE INDEX inside one of the migration files). Set AFTER the
    // advisory lock so the lock acquisition isn't capped by it.
    await client.query(`SET statement_timeout = ${statementTimeoutMs}`);

    await ensureSchemaVersionTable(client);
    const currentVersion = await readCurrentVersion(client);
    const pending = listPendingMigrations(options.migrationsDir, currentVersion);

    options.onProgress?.({
      phase: "planned",
      index: 0,
      total: pending.length,
      version: 0,
      file: "",
    });

    const appliedFiles: string[] = [];
    for (let i = 0; i < pending.length; i += 1) {
      const migration = pending[i];
      if (migration === undefined) continue; // satisfies noUncheckedIndexedAccess
      options.onProgress?.({
        phase: "start",
        index: i,
        total: pending.length,
        version: migration.version,
        file: migration.file,
      });

      await applyMigration(client, migration, options.migrationsDir);
      appliedFiles.push(migration.file);

      options.onProgress?.({
        phase: "applied",
        index: i,
        total: pending.length,
        version: migration.version,
        file: migration.file,
      });
    }

    return {
      applied: appliedFiles.length,
      files: appliedFiles,
    };
  } finally {
    await releaseMigrationClient(client, lockAcquired);
  }
}

// ---------------------------------------------------------------------------
// schema_version drift self-heal
//
// Guards against the failure mode that took the app down: partial DB-state
// loss (disk-full / Docker thrash) wiped tables while leaving the
// `schema_version` counter intact. Because the counter still said "applied",
// the normal migration pass skipped re-creating those tables forever, and
// downstream code (`active session policy hydration`) failed hard — the agent
// looked "stuck" and could not trade.
//
// Re-running the file that owns a vanished table restores it — but the
// migrations are NOT uniformly idempotent: 001_initial.sql and several others
// use PLAIN `CREATE TABLE` (no `IF NOT EXISTS`) for ~34 tables. Re-running
// such a file as one transaction aborts on the FIRST already-present table
// (SQLSTATE 42P07 duplicate_table), rolling back every repair including the
// truly-missing table. So the re-run executes each statement under its own
// SAVEPOINT and SWALLOWS "already exists" errors (42P07 tables/indexes, 42710
// duplicate_object for constraints/types, 42701 duplicate_column), rolling
// back only that one statement and continuing. Net effect: only the missing
// objects get created; present ones are skipped; nothing is ever dropped.
// ---------------------------------------------------------------------------

/**
 * Matches `CREATE TABLE [IF NOT EXISTS] <name>` (optionally UNLOGGED /
 * double-quoted). All Vex migrations create unqualified public-schema
 * tables, so we capture a single bare identifier. SQL comments are
 * stripped first so a `-- ... CREATE TABLE ...` note can't be mistaken
 * for a real statement.
 */
const CREATE_TABLE_RE =
  /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_$]*)"?/gi;

/**
 * Matches `DROP TABLE [IF EXISTS] <name>`. Used to subtract intentionally-
 * removed tables from the expected set so self-heal never resurrects a table
 * a later migration deliberately dropped (e.g. 033_drop_recall_cache.sql).
 */
const DROP_TABLE_RE =
  /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_$]*)"?/gi;

/** A migration file and the tables its SQL declares via CREATE TABLE. */
interface MigrationExpectedTables {
  readonly version: number;
  readonly file: string;
  readonly tables: ReadonlyArray<string>;
}

/** One migration that was drifted and successfully re-run. */
export interface HealedMigration {
  readonly version: number;
  readonly file: string;
  /** Tables that were missing before the heal re-ran the migration. */
  readonly missingTables: ReadonlyArray<string>;
}

/** One migration whose heal attempt failed (isolated; does not abort others). */
export interface DriftHealFailure {
  readonly version: number;
  readonly file: string;
  readonly error: string;
}

export interface SchemaDriftHealResult {
  readonly healed: ReadonlyArray<HealedMigration>;
  readonly failures: ReadonlyArray<DriftHealFailure>;
}

/** Minimal logger the self-heal writes to (maps onto the app logger). */
export interface HealLogger {
  readonly warn: (msg: string) => void;
  readonly info?: (msg: string) => void;
  readonly error?: (msg: string) => void;
  /** Swallowed per-statement "already exists" notices during a re-run. */
  readonly debug?: (msg: string) => void;
}

export interface HealSchemaDriftOptions {
  readonly pool: pg.Pool;
  readonly migrationsDir: string;
  readonly logger?: HealLogger;
  readonly statementTimeoutMs?: number;
  readonly lockTimeoutMs?: number;
}

/** Strip line (`--`) and block comments so they can't match CREATE_TABLE_RE. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

/** Parse the distinct table names a migration's SQL creates. */
function parseCreatedTables(sql: string): ReadonlyArray<string> {
  const cleaned = stripSqlComments(sql);
  const tables = new Set<string>();
  let match: RegExpExecArray | null;
  CREATE_TABLE_RE.lastIndex = 0;
  while ((match = CREATE_TABLE_RE.exec(cleaned)) !== null) {
    if (match[1]) tables.add(match[1]);
  }
  return [...tables];
}

/** Parse the distinct table names a migration's SQL drops. */
function parseDroppedTables(sql: string): ReadonlyArray<string> {
  const cleaned = stripSqlComments(sql);
  const tables = new Set<string>();
  let match: RegExpExecArray | null;
  DROP_TABLE_RE.lastIndex = 0;
  while ((match = DROP_TABLE_RE.exec(cleaned)) !== null) {
    if (match[1]) tables.add(match[1]);
  }
  return [...tables];
}

/**
 * Build the version → expected-tables map from the migrations dir.
 * Migrations that CREATE no table (pure ALTER/ADD COLUMN, e.g. 039) are
 * dropped, so they can never be misflagged as drifted.
 *
 * Drop-hazard guard: a table a later migration DROPs is intentionally gone,
 * so it is subtracted from the expected set — otherwise self-heal would see
 * it "missing" and resurrect it. The subtraction is version-aware: a table is
 * only removed from a migration's expected list if a HIGHER-versioned
 * migration drops it, so a later re-CREATE (whose version is above the drop)
 * is still correctly expected. This makes heal correct-by-construction even if
 * a future `DROP TABLE foo` migration forgets to also remove the original
 * `CREATE TABLE foo` (the convention 033_drop_recall_cache.sql follows).
 */
function buildExpectedTables(
  migrationsDir: string
): ReadonlyArray<MigrationExpectedTables> {
  const parsed = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql") && /^\d{3}_/.test(f))
    .sort()
    .map((file) => {
      const sql = readFileSync(path.join(migrationsDir, file), "utf-8");
      return {
        version: parseInt(file.slice(0, 3), 10),
        file,
        created: parseCreatedTables(sql),
        dropped: parseDroppedTables(sql),
      };
    });

  return parsed
    .map((m) => ({
      version: m.version,
      file: m.file,
      tables: m.created.filter(
        (table) =>
          !parsed.some(
            (other) =>
              other.version > m.version && other.dropped.includes(table)
          )
      ),
    }))
    .filter((m) => m.tables.length > 0);
}

/** Return the subset of `tables` that do NOT currently exist in the DB. */
async function findMissingTables(
  client: pg.PoolClient,
  tables: ReadonlyArray<string>
): Promise<ReadonlyArray<string>> {
  const missing: string[] = [];
  for (const table of tables) {
    // to_regclass returns NULL (not an error) when the relation is absent.
    const res = await client.query<{ reg: string | null }>(
      "SELECT to_regclass($1) AS reg",
      [table]
    );
    if (res.rows[0]?.reg == null) missing.push(table);
  }
  return missing;
}

/**
 * SQLSTATE codes for "object already exists", swallowed during a heal re-run
 * so a non-idempotent statement targeting a surviving object doesn't abort
 * the repair of the truly-missing ones.
 *   - 42P07 duplicate_table   (tables AND indexes)
 *   - 42710 duplicate_object  (constraints, types, sequences, triggers, …)
 *   - 42701 duplicate_column  (ADD COLUMN without IF NOT EXISTS)
 */
const DUPLICATE_OBJECT_SQLSTATES: ReadonlySet<string> = new Set([
  "42P07",
  "42710",
  "42701",
]);

/** True for pg errors whose SQLSTATE means "this object already exists". */
function isAlreadyExistsError(err: unknown): boolean {
  if (err !== null && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    return typeof code === "string" && DUPLICATE_OBJECT_SQLSTATES.has(code);
  }
  return false;
}

/**
 * Split a migration file into individual top-level SQL statements, honouring
 * the quoting contexts where a `;` is NOT a terminator: single-quoted string
 * literals (`''` escaping), double-quoted identifiers, dollar-quoted blocks
 * (`$$ … $$` / `$tag$ … $tag$`, used by the plpgsql functions in a few
 * migrations), and line/block comments. Comment-only fragments are dropped.
 *
 * This is intentionally not a full SQL parser — it only needs to find the
 * real statement boundaries so each can be re-run under its own SAVEPOINT.
 */
function splitSqlStatements(sql: string): ReadonlyArray<string> {
  const statements: string[] = [];
  let current = "";
  let i = 0;
  const n = sql.length;

  const pushCurrent = (): void => {
    const trimmed = current.trim();
    // Skip fragments that are only comments/whitespace once comments are
    // stripped — sending a bare comment to pg is harmless but pointless.
    if (trimmed.length > 0 && stripSqlComments(trimmed).trim().length > 0) {
      statements.push(trimmed);
    }
    current = "";
  };

  while (i < n) {
    const ch = sql[i];
    const next = sql[i + 1];

    // Line comment — consume through end of line.
    if (ch === "-" && next === "-") {
      let j = i;
      while (j < n && sql[j] !== "\n") j += 1;
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Block comment — consume through the closing */.
    if (ch === "/" && next === "*") {
      let j = i + 2;
      while (j < n && !(sql[j] === "*" && sql[j + 1] === "/")) j += 1;
      j = Math.min(j + 2, n);
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Single-quoted string literal ('' is an escaped quote).
    if (ch === "'") {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Double-quoted identifier ("" is an escaped quote).
    if (ch === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"' && sql[j + 1] === '"') {
          j += 2;
          continue;
        }
        if (sql[j] === '"') {
          j += 1;
          break;
        }
        j += 1;
      }
      current += sql.slice(i, j);
      i = j;
      continue;
    }

    // Dollar-quoted block ($$ … $$ or $tag$ … $tag$). `$1` placeholders and
    // bare `$` do not match the opening-tag pattern and fall through.
    if (ch === "$") {
      const tagMatch = /^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/.exec(sql.slice(i));
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = sql.indexOf(tag, i + tag.length);
        const j = end === -1 ? n : end + tag.length;
        current += sql.slice(i, j);
        i = j;
        continue;
      }
    }

    // Statement terminator.
    if (ch === ";") {
      pushCurrent();
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  pushCurrent();
  return statements;
}

/**
 * Re-execute a migration file's SQL to repair drift. Does NOT touch
 * `schema_version` — the version is already recorded; we only recreate the
 * missing objects.
 *
 * The migrations are not uniformly idempotent (plain `CREATE TABLE`), so a
 * whole-file transaction would abort on the first surviving object. Instead
 * each statement runs under its own SAVEPOINT: an "already exists" error
 * (see DUPLICATE_OBJECT_SQLSTATES) rolls back just that statement and we
 * continue; any other error aborts the whole file (outer ROLLBACK + rethrow),
 * so a genuine failure is still surfaced and nothing is left half-applied.
 * Nothing is ever dropped.
 */
async function rerunMigrationSql(
  client: pg.PoolClient,
  migrationsDir: string,
  file: string,
  logger?: HealLogger
): Promise<void> {
  const sql = readFileSync(path.join(migrationsDir, file), "utf-8");
  const statements = splitSqlStatements(sql);
  const SAVEPOINT = "vex_heal_stmt";
  try {
    await client.query("BEGIN");
    for (const statement of statements) {
      await client.query(`SAVEPOINT ${SAVEPOINT}`);
      try {
        await client.query(statement);
        await client.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
      } catch (stmtErr: unknown) {
        if (!isAlreadyExistsError(stmtErr)) throw stmtErr;
        // Object already present — expected on re-run of a non-idempotent
        // file. Undo just this statement and move on.
        await client.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
        const code = (stmtErr as { code?: unknown }).code;
        logger?.debug?.(
          `[migrate:self-heal] ${file}: skipped already-present object (SQLSTATE ${String(code)})`
        );
      }
    }
    await client.query("COMMIT");
  } catch (cause: unknown) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw cause;
  }
}

/**
 * Detect and repair `schema_version` drift: migrations recorded as applied
 * whose CREATEd tables have since vanished. Runs at boot right after the
 * normal migration pass.
 *
 * For each migration that (a) declares one or more tables and (b) is marked
 * applied in `schema_version`, we check the pg catalog for those tables. If
 * any are absent we log a warning and re-run that one migration file
 * (idempotent), then re-verify. Each re-run is isolated: one failure is
 * recorded and does not abort the others, and nothing is ever dropped.
 */
export async function healSchemaVersionDrift(
  options: HealSchemaDriftOptions
): Promise<SchemaDriftHealResult> {
  const statementTimeoutMs =
    options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const lockTimeoutMs = options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const logger = options.logger;

  const expected = buildExpectedTables(options.migrationsDir);
  if (expected.length === 0) {
    // No migration declares a table → nothing to verify. Short-circuit
    // before touching the pool.
    return { healed: [], failures: [] };
  }

  const healed: HealedMigration[] = [];
  const failures: DriftHealFailure[] = [];

  const client = await options.pool.connect();
  let lockAcquired = false;
  try {
    // Same lock discipline as the migration pass: serialize with any
    // concurrent migrate run so we don't race on re-creating objects.
    await client.query(`SET lock_timeout = ${lockTimeoutMs}`);
    await client.query("SELECT pg_advisory_lock($1::bigint)", [
      VEX_MIGRATE_LOCK_ID,
    ]);
    lockAcquired = true;
    await client.query(`SET statement_timeout = ${statementTimeoutMs}`);

    const appliedRes = await client.query<{ version: number }>(
      "SELECT version FROM schema_version"
    );
    const applied = new Set(appliedRes.rows.map((r) => r.version));

    for (const migration of expected) {
      // Only migrations the counter claims are applied are candidates for
      // drift. A not-yet-applied migration is the normal pass's job.
      if (!applied.has(migration.version)) continue;

      const missing = await findMissingTables(client, migration.tables);
      if (missing.length === 0) continue; // healthy — no false heal

      logger?.warn(
        `[migrate:self-heal] schema drift — ${migration.file} (v${migration.version}) is marked applied but table(s) missing: ${missing.join(", ")}. Re-running migration (idempotent).`
      );

      try {
        await rerunMigrationSql(
          client,
          options.migrationsDir,
          migration.file,
          logger
        );
        const stillMissing = await findMissingTables(client, migration.tables);
        if (stillMissing.length > 0) {
          const errMsg = `re-run completed but table(s) still missing: ${stillMissing.join(", ")}`;
          logger?.error?.(
            `[migrate:self-heal] ${migration.file} (v${migration.version}) ${errMsg}`
          );
          failures.push({
            version: migration.version,
            file: migration.file,
            error: errMsg,
          });
          continue;
        }
        logger?.info?.(
          `[migrate:self-heal] healed ${migration.file} (v${migration.version}); recreated: ${missing.join(", ")}`
        );
        healed.push({
          version: migration.version,
          file: migration.file,
          missingTables: missing,
        });
      } catch (cause: unknown) {
        const errMsg = cause instanceof Error ? cause.message : String(cause);
        logger?.error?.(
          `[migrate:self-heal] failed to heal ${migration.file} (v${migration.version}): ${errMsg}`
        );
        failures.push({
          version: migration.version,
          file: migration.file,
          error: errMsg,
        });
      }
    }

    return { healed, failures };
  } finally {
    await releaseMigrationClient(client, lockAcquired);
  }
}
