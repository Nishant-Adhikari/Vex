/**
 * Vex Agent — Postgres connection pool + typed query helpers.
 *
 * Own pool, own connection string (VEX_DB_URL).
 * Does NOT share pool with legacy src/agent/db/client.ts.
 *
 * Helpers come in two flavors:
 *   - `queryWith` / `queryOneWith` / `executeWith` accept an explicit
 *     `Executor` (Pool | PoolClient). Callers running inside a transaction
 *     (e.g. compact service, PR4 maintenance-lease writers) pass their
 *     own `PoolClient` so statements join the same tx.
 *   - `query` / `queryOne` / `execute` are thin wrappers that delegate to the
 *     `*With` variant using `getPool()` as the executor. They exist for the
 *     ~hundreds of non-tx call sites that just need a pool-backed query.
 *
 * Zero behavioral change for existing callers — wrappers match the previous
 * signatures exactly. New tx-aware callers opt into `*With` explicitly.
 */

import pg from "pg";
import logger from "@utils/logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    const explicitUrl = process.env.VEX_DB_URL;
    if (!explicitUrl) {
      // Loud warning: the fallback exists for dev convenience but the canonical
      // expectation is that VEX_DB_URL is set explicitly (matches the
      // compose stack on port 5777). A future PR may remove the fallback entirely.
      logger.warn("vex-db.pool.using_fallback_url", {
        hint: "VEX_DB_URL not set — using fallback postgresql://vex:vex@localhost:5777/vex_test. Set explicitly to silence this warning.",
      });
    }
    const connectionString = explicitUrl
      ?? "postgresql://vex:vex@localhost:5777/vex_test";
    pool = new Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
    pool.on("error", (err) => {
      logger.error("vex-db.pool.error", { error: err.message });
    });
  }
  return pool;
}

/**
 * Executor abstraction — either the shared pool or a specific `PoolClient`
 * that belongs to an open transaction. Both expose the same `.query()`
 * method shape, so tx-aware helpers can accept either.
 */
export type Executor = pg.Pool | pg.PoolClient;

// ── tx-aware helpers (primary API) ──────────────────────────────────

/** Run a query on the given executor and return all rows typed as T. */
export async function queryWith<T extends pg.QueryResultRow>(
  exec: Executor,
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  const result = await exec.query<T>(sql, params);
  return result.rows;
}

/** Run a query on the given executor and return the first row, or null. */
export async function queryOneWith<T extends pg.QueryResultRow>(
  exec: Executor,
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  const result = await exec.query<T>(sql, params);
  return result.rows[0] ?? null;
}

/** Run a mutation on the given executor and return affected row count. */
export async function executeWith(
  exec: Executor,
  sql: string,
  params?: unknown[],
): Promise<number> {
  const result = await exec.query(sql, params);
  return result.rowCount ?? 0;
}

// ── Thin wrappers (backward-compatible) ─────────────────────────────

/** Run a query on the shared pool and return all rows typed as T. */
export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T[]> {
  return queryWith<T>(getPool(), sql, params);
}

/** Run a query on the shared pool and return the first row, or null. */
export async function queryOne<T extends pg.QueryResultRow>(
  sql: string,
  params?: unknown[],
): Promise<T | null> {
  return queryOneWith<T>(getPool(), sql, params);
}

/** Run a mutation on the shared pool and return affected row count. */
export async function execute(sql: string, params?: unknown[]): Promise<number> {
  return executeWith(getPool(), sql, params);
}

/**
 * Run `fn` inside a `BEGIN`/`COMMIT` block on a dedicated `PoolClient`.
 * Rollback on throw, always release the client. Returns whatever `fn`
 * resolves with.
 *
 * The wrapper exists so callers that need atomicity across multiple
 * statements (e.g. `appendMessage` — INSERT messages + UPDATE
 * sessions.message_count, then emit-after-commit) get one obvious entry
 * point instead of hand-rolling `getPool().connect()` + try/finally
 * everywhere. ROLLBACK errors are swallowed with `.catch(() => undefined)`
 * so they cannot mask the original failure — the original throw is what
 * the caller cares about.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    // Swallow rollback errors so they cannot mask the original failure
    // (the rethrow below carries the actionable diagnostic).
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** Graceful shutdown — drain the pool. */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("vex-db.pool.closed");
  }
}
