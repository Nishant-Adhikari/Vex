/**
 * Memory-jobs DB helper — schema-readiness gate for the memory_manager worker
 * supervisor (S4 §4/§10).
 *
 * Mirrors `compaction-db.ts` / `wake-db.ts`'s probe: own `pg.Client` per call, no
 * `@vex-agent/db/repos/*` import. `probeMemoryJobsReady()` proves Postgres is
 * reachable AND the `memory_jobs` table exists (migrations applied) — not merely
 * that `VEX_DB_URL` resolves — so the supervisor keeps the executor idle rather
 * than spamming claim errors before the DB is ready.
 */

import { Client, type ClientConfig } from "pg";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

/**
 * `true` only when Postgres is reachable AND `public.memory_jobs` exists
 * (migrations ran). Any failure (config absent, connect error, table missing,
 * query error) → `false`, so the supervisor keeps the memory_manager executor
 * idle rather than starting it against a not-yet-migrated DB.
 */
export async function probeMemoryJobsReady(): Promise<boolean> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[memory-jobs-db] buildPoolConfig threw", cause);
    return false;
  }
  if (cfg === null) return false;

  const clientConfig: ClientConfig = {
    host: cfg.host,
    port: cfg.port,
    database: cfg.database,
    user: cfg.user,
    password: cfg.password,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
  };
  const client = new Client(clientConfig);
  try {
    await client.connect();
  } catch (cause) {
    log.warn("[memory-jobs-db] client.connect failed", cause);
    return false;
  }
  try {
    const r = await client.query<{ reg: string | null }>(
      `SELECT to_regclass('public.memory_jobs') AS reg`,
    );
    return r.rows[0]?.reg != null;
  } catch (cause) {
    log.warn("[memory-jobs-db] probeMemoryJobsReady query failed", cause);
    return false;
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[memory-jobs-db] client.end failed (non-fatal)", cause);
    }
  }
}
