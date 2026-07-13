/**
 * Signals DB helper — schema-readiness gate for the signals-ingest supervisor.
 *
 * Mirrors `sync-db.ts`'s probe: own `pg.Client` per call, no
 * `@vex-agent/db/repos/*` import. `probeSignalsReady()` proves Postgres is
 * reachable AND the `signals` table exists (migration 037 applied) — not merely
 * that `VEX_DB_URL` resolves. The signals executor ticks HOURLY, so a first tick
 * against a not-yet-migrated DB would fail and not retry for an hour; gating on
 * this probe keeps the executor idle until the table is genuinely there.
 */

import { Client, type ClientConfig } from "pg";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

/**
 * `true` only when Postgres is reachable AND `public.signals` exists (migration
 * ran). Any failure (config absent, connect error, table missing, query error)
 * → `false`, so the supervisor keeps the signals executor idle rather than
 * starting it against a not-yet-migrated DB.
 */
export async function probeSignalsReady(): Promise<boolean> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[signals-db] buildPoolConfig threw", cause);
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
    log.warn("[signals-db] client.connect failed", cause);
    return false;
  }
  try {
    const r = await client.query<{ reg: string | null }>(
      `SELECT to_regclass('public.signals') AS reg`,
    );
    return r.rows[0]?.reg != null;
  } catch (cause) {
    log.warn("[signals-db] probeSignalsReady query failed", cause);
    return false;
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[signals-db] client.end failed (non-fatal)", cause);
    }
  }
}
