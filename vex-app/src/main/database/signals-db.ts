/**
 * Signals DB helper — the schema-readiness gate for the signals-ingest
 * supervisor PLUS the read-only list/by-id reads that back the Signals panel.
 *
 * Mirrors `long-memory-db.ts`: own `pg.Client` per call, no
 * `@vex-agent/db/repos/*` import. `probeSignalsReady()` proves Postgres is
 * reachable AND the `signals` table exists (migration 037 applied). The read
 * helpers (`listTodaySignals` / `getSignalById`) return sanitized DTOs — the
 * `raw` jsonb is parsed HERE (three known fields lifted out), never forwarded
 * to the renderer. Read-only w.r.t. trading: nothing here mutates state.
 */

import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import {
  type SignalListItemDto,
  type SignalsListTodayInput,
  type SignalsListTodayResult,
} from "@shared/schemas/signals.js";
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

// ── Read helpers (Signals panel) ────────────────────────────────────────────

function dbUnavailable(correlationId: string): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "signals",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
    correlationId,
  });
}

function dbError(
  reason: string,
  correlationId: string,
  cause?: unknown,
): Result<never, VexError> {
  log.warn(`[signals-db] ${reason}`, cause);
  return err({
    code: "internal.unexpected",
    domain: "signals",
    message: "Unable to load signals.",
    retryable: true,
    userActionable: false,
    redacted: true,
    correlationId,
  });
}

async function withClient<T>(
  correlationId: string,
  fn: (client: Client) => Promise<Result<T, VexError>>,
): Promise<Result<T, VexError>> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[signals-db] buildPoolConfig threw", cause);
    return dbUnavailable(correlationId);
  }
  if (cfg === null) return dbUnavailable(correlationId);

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
    return dbUnavailable(correlationId);
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[signals-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface SignalDbRow {
  readonly id: number | string;
  readonly source: string;
  readonly chain: string;
  readonly contract: string;
  readonly symbol: string | null;
  readonly action: string | null;
  readonly score: number | string | null;
  readonly today_mentions: number | string | null;
  readonly yesterday_mentions: number | string | null;
  readonly velocity_pct: number | string | null;
  readonly liquidity_usd: number | string | null;
  readonly volume_24h_usd: number | string | null;
  readonly price_usd: number | string | null;
  readonly narratives: string[] | null;
  readonly risk_flags: string[] | null;
  readonly raw: unknown;
  readonly feed_generated_at: string | Date | null;
  readonly ingested_at: string | Date;
}

const SELECT_COLUMNS = `id, source, chain, contract, symbol, action, score,
  today_mentions, yesterday_mentions, velocity_pct, liquidity_usd,
  volume_24h_usd, price_usd, narratives, risk_flags, raw,
  feed_generated_at, ingested_at`;

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function toNum(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function toStr(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Lift the three renderer-facing fields out of the row's `raw` jsonb so the
 * arbitrary provider payload never crosses the IPC boundary. Defensive: any
 * shape other than a plain object yields all-nulls. Exported for unit tests.
 */
export function extractRawFields(raw: unknown): {
  readonly priceChange24hPct: number | null;
  readonly marketCapUsd: number | null;
  readonly dexscreenerUrl: string | null;
} {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { priceChange24hPct: null, marketCapUsd: null, dexscreenerUrl: null };
  }
  const r = raw as Record<string, unknown>;
  return {
    priceChange24hPct: toNum(r["price_change_24h_pct"] as number | string | null),
    marketCapUsd:
      toNum(r["market_cap"] as number | string | null) ??
      toNum(r["fdv"] as number | string | null),
    dexscreenerUrl: toStr(r["dexscreener_url"]),
  };
}

/** Map a DB row to the sanitized panel DTO. Exported for unit tests. */
export function mapSignalRow(r: SignalDbRow): SignalListItemDto {
  const rawFields = extractRawFields(r.raw);
  return {
    id: typeof r.id === "number" ? r.id : Number.parseInt(String(r.id), 10),
    source: r.source,
    chain: r.chain,
    contract: r.contract,
    symbol: r.symbol,
    action: r.action,
    score: toNum(r.score),
    todayMentions: toNum(r.today_mentions),
    yesterdayMentions: toNum(r.yesterday_mentions),
    velocityPct: toNum(r.velocity_pct),
    liquidityUsd: toNum(r.liquidity_usd),
    volume24hUsd: toNum(r.volume_24h_usd),
    priceUsd: toNum(r.price_usd),
    priceChange24hPct: rawFields.priceChange24hPct,
    marketCapUsd: rawFields.marketCapUsd,
    dexscreenerUrl: rawFields.dexscreenerUrl,
    narratives: r.narratives ?? [],
    riskFlags: r.risk_flags ?? [],
    feedGeneratedAt: toIso(r.feed_generated_at),
    ingestedAt: toIso(r.ingested_at) ?? new Date(0).toISOString(),
  };
}

/**
 * List today's signals — rows ingested within `withinHours`, newest first
 * (most recent ingest at the top; score as the tiebreak). The panel groups the
 * result by hour, so newest-first here keeps the freshest hour on top even when
 * `input.limit` truncates. Bounded by `input.limit` (validated + capped in the
 * shared schema).
 */
export async function listTodaySignals(
  input: SignalsListTodayInput,
  correlationId: string,
): Promise<Result<SignalsListTodayResult, VexError>> {
  return withClient(correlationId, async (client) => {
    try {
      const result = await client.query<SignalDbRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM signals
          WHERE ingested_at > NOW() - make_interval(hours => $1::int)
          ORDER BY ingested_at DESC, score DESC NULLS LAST,
                   feed_generated_at DESC NULLS LAST
          LIMIT $2`,
        [input.withinHours, input.limit],
      );
      return ok(result.rows.map(mapSignalRow));
    } catch (cause) {
      return dbError("listTodaySignals query failed", correlationId, cause);
    }
  });
}

/** Fetch one signal by id for grading. `ok(null)` when the id is unknown. */
export async function getSignalById(
  id: number,
  correlationId: string,
): Promise<Result<SignalListItemDto | null, VexError>> {
  return withClient(correlationId, async (client) => {
    try {
      const result = await client.query<SignalDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM signals WHERE id = $1 LIMIT 1`,
        [id],
      );
      const row = result.rows[0];
      return ok(row === undefined ? null : mapSignalRow(row));
    } catch (cause) {
      return dbError("getSignalById query failed", correlationId, cause);
    }
  });
}
