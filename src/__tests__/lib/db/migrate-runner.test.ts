/**
 * Direct tests for the shared migration runner. Codex turn 2 flagged
 * that the engine + vex-app suites both mock this module — the lock
 * sequencing, rollback path, MigrationError shape, and unlock-failure
 * handling were the most important new logic and were under-tested.
 *
 * These tests run with a controllable mock pg.Pool/PoolClient so we
 * can assert the exact SQL call sequence + verify error paths.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type pg from "pg";
import {
  MigrationError,
  runMigrationsWithProgress,
  healSchemaVersionDrift,
  type MigrationProgressEvent,
} from "../../../lib/db/migrate-runner.js";

interface ClientCall {
  readonly sql: string;
  readonly params: unknown[] | undefined;
}

interface MockClient {
  readonly calls: ClientCall[];
  readonly release: ReturnType<typeof vi.fn>;
  setQueryImpl: (
    fn: (sql: string, params: unknown[] | undefined) => Promise<unknown>
  ) => void;
}

interface MockPool {
  readonly pool: pg.Pool;
  readonly client: MockClient;
}

/**
 * Build a mock pg.Pool whose `connect()` resolves to a single
 * controllable client. `setQueryImpl` overrides the default query
 * dispatcher per test.
 */
function makeMockPool(currentVersion = 0): MockPool {
  const calls: ClientCall[] = [];
  let queryImpl: (
    sql: string,
    params: unknown[] | undefined
  ) => Promise<unknown> = async (sql) => {
    if (/SELECT COALESCE\(MAX\(version\)/i.test(sql)) {
      return { rows: [{ version: currentVersion }] };
    }
    return undefined;
  };
  const release = vi.fn();
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      calls.push({ sql, params });
      return queryImpl(sql, params);
    }),
    release,
  };
  const pool = {
    connect: vi.fn(async () => client),
  } as unknown as pg.Pool;
  return {
    pool,
    client: {
      calls,
      release,
      setQueryImpl: (fn) => {
        queryImpl = fn;
      },
    },
  };
}

let tmpDir = "";

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "vex-shared-migrate-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function indexOfCall(
  calls: ClientCall[],
  pattern: RegExp
): number {
  return calls.findIndex((c) => pattern.test(c.sql));
}

describe("runMigrationsWithProgress — lock + timeout sequencing", () => {
  it("sets lock_timeout BEFORE acquiring advisory lock, statement_timeout AFTER", async () => {
    const { pool, client } = makeMockPool();
    await runMigrationsWithProgress({ pool, migrationsDir: tmpDir });

    const lockTimeoutIdx = indexOfCall(client.calls, /SET lock_timeout/i);
    const acquireIdx = indexOfCall(
      client.calls,
      /pg_advisory_lock\(\$1::bigint\)/i
    );
    const stmtTimeoutIdx = indexOfCall(
      client.calls,
      /SET statement_timeout/i
    );

    expect(lockTimeoutIdx).toBeGreaterThanOrEqual(0);
    expect(acquireIdx).toBeGreaterThanOrEqual(0);
    expect(stmtTimeoutIdx).toBeGreaterThanOrEqual(0);
    expect(lockTimeoutIdx).toBeLessThan(acquireIdx);
    expect(acquireIdx).toBeLessThan(stmtTimeoutIdx);
  });

  it("acquires the advisory lock BEFORE reading current schema version", async () => {
    const { pool, client } = makeMockPool();
    await runMigrationsWithProgress({ pool, migrationsDir: tmpDir });

    const acquireIdx = indexOfCall(
      client.calls,
      /pg_advisory_lock\(\$1::bigint\)/i
    );
    const versionReadIdx = indexOfCall(
      client.calls,
      /SELECT COALESCE\(MAX\(version\)/i
    );
    expect(acquireIdx).toBeGreaterThanOrEqual(0);
    expect(versionReadIdx).toBeGreaterThan(acquireIdx);
  });

  it("uses the configured lockTimeoutMs and statementTimeoutMs", async () => {
    const { pool, client } = makeMockPool();
    await runMigrationsWithProgress({
      pool,
      migrationsDir: tmpDir,
      lockTimeoutMs: 7_777,
      statementTimeoutMs: 88_888,
    });
    const lockCall = client.calls.find((c) => /SET lock_timeout/i.test(c.sql));
    const stmtCall = client.calls.find((c) =>
      /SET statement_timeout/i.test(c.sql)
    );
    expect(lockCall?.sql).toContain("7777");
    expect(stmtCall?.sql).toContain("88888");
  });
});

describe("runMigrationsWithProgress — applied + noop", () => {
  it("returns noop ({applied:0}) when no pending migrations", async () => {
    const { pool } = makeMockPool();
    const result = await runMigrationsWithProgress({
      pool,
      migrationsDir: tmpDir,
    });
    expect(result.applied).toBe(0);
    expect(result.files).toEqual([]);
  });

  it("applies each pending migration in order and returns count + files", async () => {
    writeFileSync(join(tmpDir, "001_initial.sql"), "CREATE TABLE a(id int);");
    writeFileSync(join(tmpDir, "002_second.sql"), "CREATE TABLE b(id int);");
    const { pool, client } = makeMockPool();

    const result = await runMigrationsWithProgress({
      pool,
      migrationsDir: tmpDir,
    });

    expect(result.applied).toBe(2);
    expect(result.files).toEqual(["001_initial.sql", "002_second.sql"]);
    // Verify both migrations ran inside their own BEGIN/COMMIT block.
    const beginCount = client.calls.filter((c) => c.sql === "BEGIN").length;
    const commitCount = client.calls.filter((c) => c.sql === "COMMIT").length;
    expect(beginCount).toBe(2);
    expect(commitCount).toBe(2);
  });

  it("emits planned/start/applied progress events with correct index/total", async () => {
    writeFileSync(join(tmpDir, "001_a.sql"), "CREATE TABLE a(id int);");
    writeFileSync(join(tmpDir, "002_b.sql"), "CREATE TABLE b(id int);");
    const { pool } = makeMockPool();

    const events: MigrationProgressEvent[] = [];
    await runMigrationsWithProgress({
      pool,
      migrationsDir: tmpDir,
      onProgress: (e) => events.push(e),
    });

    expect(events[0]).toMatchObject({ phase: "planned", total: 2 });
    expect(events[1]).toMatchObject({
      phase: "start",
      index: 0,
      total: 2,
      version: 1,
      file: "001_a.sql",
    });
    expect(events[2]).toMatchObject({
      phase: "applied",
      index: 0,
      total: 2,
      version: 1,
    });
    expect(events[3]).toMatchObject({
      phase: "start",
      index: 1,
      total: 2,
      version: 2,
      file: "002_b.sql",
    });
    expect(events[4]).toMatchObject({
      phase: "applied",
      index: 1,
      total: 2,
      version: 2,
    });
  });

  it("skips migrations whose version is <= currentVersion", async () => {
    writeFileSync(join(tmpDir, "001_a.sql"), "select 1");
    writeFileSync(join(tmpDir, "002_b.sql"), "select 2");
    writeFileSync(join(tmpDir, "003_c.sql"), "select 3");
    const { pool } = makeMockPool(2);

    const result = await runMigrationsWithProgress({
      pool,
      migrationsDir: tmpDir,
    });
    expect(result.applied).toBe(1);
    expect(result.files).toEqual(["003_c.sql"]);
  });
});

describe("runMigrationsWithProgress — failure paths", () => {
  it("rolls back the transaction when the migration SQL throws", async () => {
    writeFileSync(join(tmpDir, "001_bad.sql"), "INVALID SQL;");
    const { pool, client } = makeMockPool();

    client.setQueryImpl(async (sql) => {
      if (/SELECT COALESCE\(MAX\(version\)/i.test(sql)) {
        return { rows: [{ version: 0 }] };
      }
      if (sql === "INVALID SQL;") {
        throw new Error("syntax error at or near INVALID");
      }
      return undefined;
    });

    await expect(
      runMigrationsWithProgress({ pool, migrationsDir: tmpDir })
    ).rejects.toBeInstanceOf(MigrationError);

    expect(client.calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
    expect(client.calls.some((c) => c.sql === "COMMIT")).toBe(false);
  });

  it("throws MigrationError carrying version + file + cause", async () => {
    writeFileSync(join(tmpDir, "007_bad.sql"), "BOOM;");
    const { pool, client } = makeMockPool();
    const cause = new Error("syntax error");

    client.setQueryImpl(async (sql) => {
      if (/SELECT COALESCE\(MAX\(version\)/i.test(sql)) {
        return { rows: [{ version: 0 }] };
      }
      if (sql === "BOOM;") {
        throw cause;
      }
      return undefined;
    });

    try {
      await runMigrationsWithProgress({ pool, migrationsDir: tmpDir });
      expect.fail("should have thrown");
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(MigrationError);
      const me = err as MigrationError;
      expect(me.version).toBe(7);
      expect(me.file).toBe("007_bad.sql");
      expect(me.cause).toBe(cause);
      expect(me.name).toBe("MigrationError");
    }
  });

  it("releases the advisory lock + RESET ALL even after a migration failure", async () => {
    writeFileSync(join(tmpDir, "001_bad.sql"), "BOOM;");
    const { pool, client } = makeMockPool();

    client.setQueryImpl(async (sql) => {
      if (/SELECT COALESCE\(MAX\(version\)/i.test(sql)) {
        return { rows: [{ version: 0 }] };
      }
      if (sql === "BOOM;") {
        throw new Error("oops");
      }
      return undefined;
    });

    await expect(
      runMigrationsWithProgress({ pool, migrationsDir: tmpDir })
    ).rejects.toBeInstanceOf(MigrationError);

    const unlockIdx = indexOfCall(
      client.calls,
      /pg_advisory_unlock\(\$1::bigint\)/i
    );
    const resetIdx = indexOfCall(client.calls, /^RESET ALL$/i);
    expect(unlockIdx).toBeGreaterThanOrEqual(0);
    expect(resetIdx).toBeGreaterThan(unlockIdx);
    expect(client.release).toHaveBeenCalledTimes(1);
    // Plain release (no truthy arg) — this is a normal failure path,
    // not the unlock-failure path.
    expect(client.release.mock.calls[0]?.[0]).toBeUndefined();
  });
});

describe("runMigrationsWithProgress — unlock failure handling", () => {
  it("destroys the client when pg_advisory_unlock fails", async () => {
    const { pool, client } = makeMockPool();

    client.setQueryImpl(async (sql) => {
      if (/SELECT COALESCE\(MAX\(version\)/i.test(sql)) {
        return { rows: [{ version: 0 }] };
      }
      if (/pg_advisory_unlock\(\$1::bigint\)/i.test(sql)) {
        throw new Error("connection lost during unlock");
      }
      return undefined;
    });

    await runMigrationsWithProgress({ pool, migrationsDir: tmpDir });

    expect(client.release).toHaveBeenCalledTimes(1);
    // release was called with truthy (Error) → pg-pool destroys the
    // client instead of returning it to the pool.
    const arg = client.release.mock.calls[0]?.[0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toContain("pg_advisory_unlock failed");
  });

  it("does NOT destroy the client on a normal successful run", async () => {
    const { pool, client } = makeMockPool();
    await runMigrationsWithProgress({ pool, migrationsDir: tmpDir });
    expect(client.release).toHaveBeenCalledTimes(1);
    expect(client.release.mock.calls[0]?.[0]).toBeUndefined();
  });
});

/**
 * Self-heal tests. Models the exact failure that broke the app: the
 * `schema_version` table said migrations 038/040 were applied, but the
 * hyperliquid_* tables those migrations CREATE had vanished (partial DB
 * state loss). The runner skipped re-creating them forever because the
 * version counter was intact. `healSchemaVersionDrift` closes that gap.
 *
 * The mock DB is stateful: it tracks a `Set` of existing tables and a
 * `Set` of applied versions. `to_regclass($1)` resolves against the
 * existing-tables set; executing a migration's SQL string (an idempotent
 * `CREATE TABLE IF NOT EXISTS`) adds the created table(s) back — modelling
 * the idempotent re-run repairing the drift.
 */
const CREATE_TABLE_IN_SQL = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_$]*)"?/gi;

function makeDriftPool(
  existingTables: Iterable<string>,
  appliedVersions: Iterable<number>
): MockPool & { existing: Set<string> } {
  const base = makeMockPool();
  const existing = new Set<string>(existingTables);
  const applied = new Set<number>(appliedVersions);
  base.client.setQueryImpl(async (sql, params) => {
    if (/SELECT version FROM schema_version/i.test(sql)) {
      return { rows: [...applied].map((version) => ({ version })) };
    }
    if (/SELECT COALESCE\(MAX\(version\)/i.test(sql)) {
      return { rows: [{ version: Math.max(0, ...applied) }] };
    }
    if (/to_regclass/i.test(sql)) {
      const name = String(params?.[0]);
      return { rows: [{ reg: existing.has(name) ? name : null }] };
    }
    // Simulate an idempotent migration re-run creating its table(s).
    if (/CREATE\s+TABLE/i.test(sql)) {
      let m: RegExpExecArray | null;
      CREATE_TABLE_IN_SQL.lastIndex = 0;
      while ((m = CREATE_TABLE_IN_SQL.exec(sql)) !== null) {
        if (m[1]) existing.add(m[1]);
      }
    }
    return undefined;
  });
  return { ...base, existing };
}

const SQL_038 =
  "CREATE TABLE IF NOT EXISTS hyperliquid_session_policies (id INT);";
const SQL_039 =
  "ALTER TABLE protocol_executions ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'succeeded';";
const SQL_040 = [
  "CREATE TABLE IF NOT EXISTS hyperliquid_candles (id INT);",
  "CREATE TABLE IF NOT EXISTS hyperliquid_candle_watches (id INT);",
].join("\n");

function writeHyperliquidMigrations(): void {
  writeFileSync(join(tmpDir, "038_hyperliquid_session_policies.sql"), SQL_038);
  writeFileSync(join(tmpDir, "039_hyperliquid_execution_intents.sql"), SQL_039);
  writeFileSync(join(tmpDir, "040_hyperliquid_candles.sql"), SQL_040);
}

describe("healSchemaVersionDrift — drift detection + repair", () => {
  it("re-runs an applied migration whose CREATEd table vanished (038/040 case)", async () => {
    writeHyperliquidMigrations();
    // 038/039/040 all marked applied, but the hyperliquid tables are gone.
    // protocol_executions (039's ALTER target) still exists.
    const { pool, client, existing } = makeDriftPool(
      ["protocol_executions", "schema_version"],
      [38, 39, 40]
    );
    const warn = vi.fn();

    const result = await healSchemaVersionDrift({
      pool,
      migrationsDir: tmpDir,
      logger: { warn },
    });

    // Only the two CREATE-TABLE migrations healed; 039 (ALTER-only) is not.
    expect(result.healed.map((h) => h.version).sort()).toEqual([38, 40]);
    expect(result.failures).toEqual([]);
    // Tables are present again after the idempotent re-run.
    expect(existing.has("hyperliquid_session_policies")).toBe(true);
    expect(existing.has("hyperliquid_candles")).toBe(true);
    expect(existing.has("hyperliquid_candle_watches")).toBe(true);
    // A clear warning was logged naming the drifted migration.
    expect(warn).toHaveBeenCalled();
    const warnText = warn.mock.calls.map((c) => String(c[0])).join("\n");
    expect(warnText).toMatch(/038_hyperliquid_session_policies\.sql/);
    expect(warnText).toMatch(/hyperliquid_candle_watches/);
    // Each heal re-ran the SQL inside its own BEGIN/COMMIT block.
    const beginCount = client.calls.filter((c) => c.sql === "BEGIN").length;
    const commitCount = client.calls.filter((c) => c.sql === "COMMIT").length;
    expect(beginCount).toBe(2);
    expect(commitCount).toBe(2);
  });

  it("is a no-op when every expected table is present (no false heals)", async () => {
    writeHyperliquidMigrations();
    const { pool, client } = makeDriftPool(
      [
        "protocol_executions",
        "schema_version",
        "hyperliquid_session_policies",
        "hyperliquid_candles",
        "hyperliquid_candle_watches",
      ],
      [38, 39, 40]
    );
    const warn = vi.fn();

    const result = await healSchemaVersionDrift({
      pool,
      migrationsDir: tmpDir,
      logger: { warn },
    });

    expect(result.healed).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    // No re-runs → no BEGIN/COMMIT at all.
    expect(client.calls.some((c) => c.sql === "BEGIN")).toBe(false);
  });

  it("ignores ALTER/ADD COLUMN-only migrations (039 is never misflagged)", async () => {
    // Only the ALTER-only migration exists and is applied. Its target table
    // is intentionally absent — the healer must still not touch it, because
    // 039 CREATEs no table so it declares no expected tables.
    writeFileSync(join(tmpDir, "039_hyperliquid_execution_intents.sql"), SQL_039);
    const { pool, client } = makeDriftPool(["schema_version"], [39]);
    const warn = vi.fn();

    const result = await healSchemaVersionDrift({
      pool,
      migrationsDir: tmpDir,
      logger: { warn },
    });

    expect(result.healed).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(client.calls.some((c) => c.sql === "BEGIN")).toBe(false);
    // to_regclass is never even queried for an ALTER-only migration.
    expect(client.calls.some((c) => /to_regclass/i.test(c.sql))).toBe(false);
  });

  it("does NOT heal a migration whose version is not in schema_version", async () => {
    // 040's tables are missing AND 040 is not recorded as applied → this is
    // the normal migration pass's job, not the healer's.
    writeHyperliquidMigrations();
    const { pool } = makeDriftPool(
      ["protocol_executions", "schema_version", "hyperliquid_session_policies"],
      [38, 39]
    );

    const result = await healSchemaVersionDrift({ pool, migrationsDir: tmpDir });

    expect(result.healed).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  it("isolates a failing re-run so the rest still heal", async () => {
    writeHyperliquidMigrations();
    const base = makeMockPool();
    const existing = new Set<string>(["protocol_executions", "schema_version"]);
    const applied = new Set<number>([38, 39, 40]);
    base.client.setQueryImpl(async (sql, params) => {
      if (/SELECT version FROM schema_version/i.test(sql)) {
        return { rows: [...applied].map((version) => ({ version })) };
      }
      if (/to_regclass/i.test(sql)) {
        const name = String(params?.[0]);
        return { rows: [{ reg: existing.has(name) ? name : null }] };
      }
      // 038's SQL blows up; 040's SQL succeeds. Match by content (the heal
      // now splits files into per-statement queries, so the trailing `;` is
      // stripped and an exact-string compare would miss).
      if (/CREATE\s+TABLE/i.test(sql) && /hyperliquid_session_policies/i.test(sql)) {
        throw new Error("disk full during re-run");
      }
      if (/CREATE\s+TABLE/i.test(sql)) {
        let m: RegExpExecArray | null;
        CREATE_TABLE_IN_SQL.lastIndex = 0;
        while ((m = CREATE_TABLE_IN_SQL.exec(sql)) !== null) {
          if (m[1]) existing.add(m[1]);
        }
      }
      return undefined;
    });

    const result = await healSchemaVersionDrift({
      pool: base.pool,
      migrationsDir: tmpDir,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(result.healed.map((h) => h.version)).toEqual([40]);
    expect(result.failures.map((f) => f.version)).toEqual([38]);
    // A ROLLBACK was issued for the failed re-run.
    expect(base.client.calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
  });

  it("acquires + releases the advisory lock around the heal pass", async () => {
    writeHyperliquidMigrations();
    const { pool, client } = makeDriftPool(
      ["protocol_executions", "schema_version"],
      [38, 39, 40]
    );

    await healSchemaVersionDrift({ pool, migrationsDir: tmpDir });

    const lockIdx = indexOfCall(client.calls, /pg_advisory_lock\(\$1::bigint\)/i);
    const unlockIdx = indexOfCall(
      client.calls,
      /pg_advisory_unlock\(\$1::bigint\)/i
    );
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(unlockIdx).toBeGreaterThan(lockIdx);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it("no-ops cleanly when the migrations dir has no CREATE-TABLE files", async () => {
    writeFileSync(join(tmpDir, "039_only_alter.sql"), SQL_039);
    const { pool, client } = makeDriftPool(["schema_version"], [39]);

    const result = await healSchemaVersionDrift({ pool, migrationsDir: tmpDir });

    expect(result.healed).toEqual([]);
    expect(result.failures).toEqual([]);
    // Short-circuits before even connecting when nothing declares a table.
    expect(client.calls.length).toBe(0);
  });
});

/**
 * Non-idempotent migration resilience. The real migrations (001_initial.sql
 * and friends) use PLAIN `CREATE TABLE` — no `IF NOT EXISTS` — for ~34
 * tables. When partial DB-state loss drops one of them (say `sessions`)
 * while a sibling from the same file survives (`soul`), re-running the whole
 * file inside one transaction hits `CREATE TABLE soul` first, which raises
 * duplicate_table (SQLSTATE 42P07) and aborts the transaction, so `sessions`
 * is NEVER recreated and drift persists forever.
 *
 * The mock below closes the fidelity gap the reviewer flagged: a PLAIN
 * `CREATE TABLE x` on an already-present table THROWS a 42P07-coded error
 * (mirroring Postgres), while `CREATE TABLE IF NOT EXISTS x` is a silent
 * no-op. The old `makeDriftPool` never threw, which is exactly why the bug
 * was invisible to the suite.
 */
class PgFidelityError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "PgFidelityError";
    this.code = code;
  }
}

const CREATE_TABLE_STMT_RE =
  /CREATE\s+(?:UNLOGGED\s+)?TABLE\s+(IF\s+NOT\s+EXISTS\s+)?"?([a-zA-Z_][a-zA-Z0-9_$]*)"?/gi;

function makeFidelityDriftPool(
  existingTables: Iterable<string>,
  appliedVersions: Iterable<number>
): MockPool & { existing: Set<string> } {
  const base = makeMockPool();
  const existing = new Set<string>(existingTables);
  const applied = new Set<number>(appliedVersions);
  base.client.setQueryImpl(async (sql, params) => {
    if (/SELECT version FROM schema_version/i.test(sql)) {
      return { rows: [...applied].map((version) => ({ version })) };
    }
    if (/SELECT COALESCE\(MAX\(version\)/i.test(sql)) {
      return { rows: [{ version: Math.max(0, ...applied) }] };
    }
    if (/to_regclass/i.test(sql)) {
      const name = String(params?.[0]);
      return { rows: [{ reg: existing.has(name) ? name : null }] };
    }
    // Postgres CREATE TABLE semantics: PLAIN create on an existing relation
    // raises 42P07 and aborts at that statement (nothing after it runs);
    // IF NOT EXISTS is a silent no-op.
    if (/CREATE\s+(?:UNLOGGED\s+)?TABLE/i.test(sql)) {
      let m: RegExpExecArray | null;
      CREATE_TABLE_STMT_RE.lastIndex = 0;
      while ((m = CREATE_TABLE_STMT_RE.exec(sql)) !== null) {
        const ifNotExists = Boolean(m[1]);
        const name = m[2];
        if (!name) continue;
        if (existing.has(name)) {
          if (ifNotExists) continue; // silent no-op
          throw new PgFidelityError(
            `relation "${name}" already exists`,
            "42P07"
          );
        }
        existing.add(name);
      }
    }
    return undefined;
  });
  return { ...base, existing };
}

describe("healSchemaVersionDrift — non-idempotent (plain CREATE TABLE) resilience", () => {
  it("heals a partially-lost migration whose file uses PLAIN CREATE TABLE (42P07 on the surviving table)", async () => {
    // Mirrors 001_initial.sql: plain `CREATE TABLE` for every table. The
    // `sessions` table was lost but its sibling `soul` (declared FIRST in the
    // file) survived. A naive whole-file re-run throws 42P07 on `soul` and
    // rolls back, never recreating `sessions`.
    writeFileSync(
      join(tmpDir, "001_initial.sql"),
      "CREATE TABLE soul (id int);\nCREATE TABLE sessions (id int);"
    );
    const { pool, existing } = makeFidelityDriftPool(
      ["soul", "schema_version"],
      [1]
    );
    const warn = vi.fn();

    const result = await healSchemaVersionDrift({
      pool,
      migrationsDir: tmpDir,
      logger: { warn },
    });

    // The truly-missing table is recreated; the surviving one is untouched.
    expect(existing.has("sessions")).toBe(true);
    expect(existing.has("soul")).toBe(true);
    // Heal is reported as success — NOT a rolled-back failure.
    expect(result.healed.map((h) => h.version)).toEqual([1]);
    expect(result.failures).toEqual([]);
    const healed001 = result.healed.find((h) => h.version === 1);
    expect(healed001?.missingTables).toEqual(["sessions"]);
  });

  it("skips already-present objects instead of erroring (per-statement, not whole-file)", async () => {
    // Two surviving tables (soul, messages) → two 42P07s that must be
    // swallowed, not recorded as failures; only `sessions` is recreated.
    writeFileSync(
      join(tmpDir, "001_initial.sql"),
      "CREATE TABLE soul (id int);\nCREATE TABLE messages (id int);\nCREATE TABLE sessions (id int);"
    );
    const { pool, existing } = makeFidelityDriftPool(
      ["soul", "messages", "schema_version"],
      [1]
    );

    const result = await healSchemaVersionDrift({ pool, migrationsDir: tmpDir });

    expect(existing.has("sessions")).toBe(true);
    expect(result.healed.map((h) => h.version)).toEqual([1]);
    expect(result.failures).toEqual([]);
  });

  it("keeps a dollar-quoted function body as a single statement (does not split on inner ;)", async () => {
    // Several real migrations define plpgsql functions whose bodies contain
    // semicolons inside `$$ … $$`. The per-statement splitter must treat the
    // whole block as one statement, or the re-run would send broken SQL.
    const fnBody = [
      "CREATE TABLE sessions (id int);",
      "CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$",
      "BEGIN",
      "  NEW.updated_at := now();",
      "  RETURN NEW;",
      "END;",
      "$$ LANGUAGE plpgsql;",
    ].join("\n");
    writeFileSync(join(tmpDir, "001_initial.sql"), fnBody);
    const { pool, client, existing } = makeFidelityDriftPool(
      ["schema_version"],
      [1]
    );

    const result = await healSchemaVersionDrift({ pool, migrationsDir: tmpDir });

    expect(existing.has("sessions")).toBe(true);
    expect(result.failures).toEqual([]);
    // The function arrived intact in ONE query: opening and LANGUAGE clause
    // are in the same statement, and the inner `;`s did not spawn fragments.
    const fnCalls = client.calls.filter((c) =>
      /CREATE OR REPLACE FUNCTION touch_updated_at/i.test(c.sql)
    );
    expect(fnCalls).toHaveLength(1);
    expect(fnCalls[0]?.sql).toMatch(/LANGUAGE plpgsql/i);
    expect(fnCalls[0]?.sql).toMatch(/RETURN NEW/i);
    // No fragment consisting of a lone RETURN/END slipped through as its own
    // statement (which is what a naive `;` split would produce).
    const strayFragment = client.calls.find(
      (c) => /^\s*RETURN NEW\s*$/i.test(c.sql) || /^\s*END\s*$/i.test(c.sql)
    );
    expect(strayFragment).toBeUndefined();
  });

  it("does NOT resurrect a table a higher-versioned migration dropped (drop-hazard guard)", async () => {
    // Mirrors 033_drop_recall_cache.sql: 001 created `recall_cache_entries`
    // (plain), a later migration DROPs it. Even if 001 still declared the
    // CREATE, the table is intentionally gone — self-heal must leave it gone.
    writeFileSync(
      join(tmpDir, "001_initial.sql"),
      "CREATE TABLE soul (id int);\nCREATE TABLE recall_cache_entries (id int);"
    );
    writeFileSync(
      join(tmpDir, "033_drop_recall_cache.sql"),
      "DROP TABLE IF EXISTS recall_cache_entries;"
    );
    // Both migrations applied; the dropped table is legitimately absent.
    const { pool, client, existing } = makeFidelityDriftPool(
      ["soul", "schema_version"],
      [1, 33]
    );
    const warn = vi.fn();

    const result = await healSchemaVersionDrift({
      pool,
      migrationsDir: tmpDir,
      logger: { warn },
    });

    // No heal, no warning, and the dropped table is NOT recreated.
    expect(result.healed).toEqual([]);
    expect(result.failures).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(existing.has("recall_cache_entries")).toBe(false);
    // No re-run happened at all (soul is present, recall_cache_entries is not
    // in the expected set), so there is no BEGIN.
    expect(client.calls.some((c) => c.sql === "BEGIN")).toBe(false);
  });

  it("still expects a table that is dropped then re-created by an even-higher migration", async () => {
    // 001 creates `foo`, 010 drops it, 020 re-creates it → `foo` IS expected
    // (the re-CREATE outranks the DROP). If `foo` vanished, heal repairs it.
    writeFileSync(join(tmpDir, "001_initial.sql"), "CREATE TABLE foo (id int);");
    writeFileSync(join(tmpDir, "010_drop_foo.sql"), "DROP TABLE IF EXISTS foo;");
    writeFileSync(join(tmpDir, "020_recreate_foo.sql"), "CREATE TABLE foo (id int);");
    const { pool, existing } = makeFidelityDriftPool(["schema_version"], [1, 10, 20]);

    const result = await healSchemaVersionDrift({ pool, migrationsDir: tmpDir });

    expect(result.healed.map((h) => h.version)).toEqual([20]);
    expect(result.failures).toEqual([]);
    expect(existing.has("foo")).toBe(true);
  });

  it("does NOT swallow a genuine (non-already-exists) error — records failure + rolls back", async () => {
    // A real error (disk full — no 42P07 code) must abort the file, roll
    // back, and be recorded as a failure rather than silently skipped.
    writeFileSync(
      join(tmpDir, "001_initial.sql"),
      "CREATE TABLE sessions (id int);"
    );
    const base = makeMockPool();
    const existing = new Set<string>(["schema_version"]);
    const applied = new Set<number>([1]);
    base.client.setQueryImpl(async (sql, params) => {
      if (/SELECT version FROM schema_version/i.test(sql)) {
        return { rows: [...applied].map((version) => ({ version })) };
      }
      if (/to_regclass/i.test(sql)) {
        const name = String(params?.[0]);
        return { rows: [{ reg: existing.has(name) ? name : null }] };
      }
      if (/CREATE\s+TABLE/i.test(sql)) {
        throw new Error("could not extend file: No space left on device");
      }
      return undefined;
    });

    const result = await healSchemaVersionDrift({
      pool: base.pool,
      migrationsDir: tmpDir,
      logger: { warn: vi.fn(), error: vi.fn() },
    });

    expect(result.healed).toEqual([]);
    expect(result.failures.map((f) => f.version)).toEqual([1]);
    expect(base.client.calls.some((c) => c.sql === "ROLLBACK")).toBe(true);
  });
});
