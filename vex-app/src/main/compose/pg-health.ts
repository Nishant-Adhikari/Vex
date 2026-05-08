/**
 * Postgres health probe via direct `pg.Client` connection from the main
 * process. Replaces the previous `docker compose exec pg_isready` path
 * (codex turn 7) which hung silently when the docker exec channel was
 * unhealthy or the project name disagreed with the running stack.
 *
 * Reading the secret here is safe — main process owns the file at
 * `pgPasswordPath` (mode 0o600) and never forwards plaintext to the
 * renderer. Connection metadata returned to renderer omits the password.
 */

import { promises as fs } from "node:fs";
import pg from "pg";

const { Client } = pg;

const CONNECTION_TIMEOUT_MS = 5_000;

export interface PgProbeOptions {
  readonly host?: string;
  readonly port: number;
  readonly database?: string;
  readonly user?: string;
  readonly pgPasswordPath: string;
  readonly signal?: AbortSignal;
}

export interface PgProbeResult {
  readonly ok: boolean;
  readonly message: string;
}

async function readPassword(path: string): Promise<string> {
  const raw = await fs.readFile(path, "utf8");
  return raw.trim();
}

export async function pgConnectProbe(
  options: PgProbeOptions
): Promise<PgProbeResult> {
  if (options.signal?.aborted) {
    return { ok: false, message: "aborted" };
  }
  let password: string;
  try {
    password = await readPassword(options.pgPasswordPath);
  } catch (err: unknown) {
    return {
      ok: false,
      message: `cannot read pg_password: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
  if (password.length === 0) {
    return { ok: false, message: "pg_password is empty" };
  }

  const client = new Client({
    host: options.host ?? "127.0.0.1",
    port: options.port,
    database: options.database ?? "vex",
    user: options.user ?? "vex",
    password,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: CONNECTION_TIMEOUT_MS,
    query_timeout: CONNECTION_TIMEOUT_MS,
  });

  // Hard-abort plumbing: pg.Client doesn't natively respect AbortSignal,
  // so we race against an abort/timeout that calls client.end().
  const ac = new AbortController();
  const linked = (): void => ac.abort();
  options.signal?.addEventListener("abort", linked, { once: true });
  const timer = setTimeout(() => ac.abort(), CONNECTION_TIMEOUT_MS + 500);

  try {
    await client.connect();
    if (ac.signal.aborted) {
      return { ok: false, message: "probe aborted before query" };
    }
    const result = await client.query("select 1 as ok");
    if (
      result.rows.length === 1 &&
      (result.rows[0] as { ok?: number }).ok === 1
    ) {
      return { ok: true, message: "select 1 returned 1" };
    }
    return { ok: false, message: "select 1 returned unexpected shape" };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    return { ok: false, message };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", linked);
    // Fire-and-forget client.end(). When the server has closed the
    // socket from its side (e.g. during a postgres restart cycle) the
    // graceful close handshake can hang indefinitely; awaiting it would
    // block the probe loop after we already have the answer we needed
    // (the select 1 result). The socket gets cleaned up by the OS
    // either way.
    void client.end().catch(() => {
      // best-effort
    });
  }
}
