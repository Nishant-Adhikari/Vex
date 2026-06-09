/**
 * Regime DB helper — schema-readiness gate for the regime worker supervisor
 * (S6b §9).
 *
 * Mirrors `memory-jobs-db.ts`'s probe: own `pg.Client` per call, no
 * `@vex-agent/db/repos/*` import. `probeRegimeSnapshotsReady()` proves Postgres
 * is reachable AND the `regime_snapshots` table exists (migrations applied) —
 * not merely that `VEX_DB_URL` resolves — so the supervisor keeps the worker
 * idle rather than spamming cadence-gate errors before the DB is ready. The
 * supervisor deliberately does NOT gate on vault unlock: the worker's own
 * per-tick env gates handle that (a tick before unlock is a cheap no-op).
 */

import { Client, type ClientConfig } from "pg";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

/**
 * `true` only when Postgres is reachable AND `regime_snapshots` is queryable
 * (`SELECT 1 ... LIMIT 1` — an empty table still succeeds; a missing table
 * throws). Any failure (config absent, connect error, table missing, query
 * error) → `false`, so the supervisor keeps the regime worker idle rather than
 * starting it against a not-yet-migrated DB.
 */
export async function probeRegimeSnapshotsReady(): Promise<boolean> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[regime-db] buildPoolConfig threw", cause);
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
    log.warn("[regime-db] client.connect failed", cause);
    return false;
  }
  try {
    await client.query("SELECT 1 FROM regime_snapshots LIMIT 1");
    return true;
  } catch (cause) {
    log.warn("[regime-db] probeRegimeSnapshotsReady query failed", cause);
    return false;
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[regime-db] client.end failed (non-fatal)", cause);
    }
  }
}
