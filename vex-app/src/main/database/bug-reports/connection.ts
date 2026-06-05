/**
 * Shared connection + error helpers for the bug-reports DB repository.
 *
 * vex-app deliberately uses its own pg connections so the GUI build stays
 * decoupled from the engine (`src/vex-agent`) module graph (mirrors the
 * pattern in `sessions-db.ts` and `dim-lock.ts`).
 *
 * Connection lifecycle: each public function opens its own `pg.Client`
 * (single-shot) through `buildPoolConfig()` and closes it in `finally`. No
 * pool is kept around — these calls are infrequent, never on a hot path,
 * and the explicit lifecycle keeps connection leaks impossible to reach.
 *
 * `withClient` is the single connection wrapper; `BugReportsDbUnavailableError`
 * is single-sourced here so the create / read / upload-attempt functions all
 * fail identically when compose state is missing.
 */

import { Client, type ClientConfig } from "pg";
import { buildPoolConfig } from "../db-config.js";
import { log } from "../../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

/**
 * Bug-reports DB unavailable. Distinct from a transient query failure —
 * thrown when compose hasn't materialised the password file yet, so the
 * support sink simply has nowhere to write. The service layer maps this
 * to `support.persist_failed` (retryable: true) at the IPC boundary.
 */
export class BugReportsDbUnavailableError extends Error {
  constructor() {
    super("Bug reports DB unavailable (compose state missing).");
    this.name = "BugReportsDbUnavailableError";
  }
}

export async function withClient<T>(
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const cfg = await buildPoolConfig();
  if (cfg === null) {
    throw new BugReportsDbUnavailableError();
  }
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
    log.warn("[bug-reports-db] client.connect failed", cause);
    throw cause;
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[bug-reports-db] client.end failed (non-fatal)", cause);
    }
  }
}
