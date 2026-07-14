/**
 * Mission results read for `mission.listResults`. Own `pg.Client` per call
 * (mirrors `missions-db.ts`) — the app layer never imports `@vex-agent/db`. The
 * ledger is WRITTEN by the engine (migration 038 + capture hooks); this is the
 * renderer-facing read for the history view.
 */

import { randomUUID } from "node:crypto";
import { Client, type ClientConfig } from "pg";
import { err, ok, type Result, type VexError } from "@shared/ipc/result.js";
import type {
  MissionResultDto,
  MissionListResultsResult,
  MissionGetSessionResultResult,
} from "@shared/schemas/mission.js";
import { buildPoolConfig } from "./db-config.js";
import { log } from "../logger/index.js";

const CONNECT_TIMEOUT_MS = 2_000;
const QUERY_TIMEOUT_MS = 5_000;

function dbUnavailable(): Result<never, VexError> {
  return err({
    code: "internal.unexpected",
    domain: "mission",
    message: "Database unavailable. Verify services are running and retry.",
    retryable: true,
    userActionable: true,
    redacted: true,
    // The IPC wrapper (register-handler) overrides this with the request id;
    // a self-generated id keeps the db-layer error well-formed on its own.
    correlationId: randomUUID(),
  });
}

async function withClient<T>(
  fn: (client: Client) => Promise<Result<T, VexError>>,
): Promise<Result<T, VexError>> {
  let cfg: Awaited<ReturnType<typeof buildPoolConfig>>;
  try {
    cfg = await buildPoolConfig();
  } catch (cause) {
    log.warn("[mission-results-db] buildPoolConfig threw", cause);
    return dbUnavailable();
  }
  if (cfg === null) return dbUnavailable();

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
    log.warn("[mission-results-db] client.connect failed", cause);
    return dbUnavailable();
  }
  try {
    return await fn(client);
  } finally {
    try {
      await client.end();
    } catch (cause) {
      log.warn("[mission-results-db] client.end failed (non-fatal)", cause);
    }
  }
}

interface RawRow {
  mission_run_id: string;
  seq_no: number;
  goal_snippet: string | null;
  wallet_address: string;
  chain_id: string | number;
  started_at: Date | string;
  ended_at: Date | string | null;
  duration_s: number | null;
  bankroll_start_eth: string | null;
  bankroll_end_eth: string | null;
  pnl_eth: string | null;
  pnl_pct: string | null;
  eth_price_usd_start: string | null;
  eth_price_usd_end: string | null;
  trades: number;
  outcome: string;
  open_positions_count: number;
  stop_summary: string | null;
}

const num = (v: string | number | null): number | null =>
  v === null ? null : Number(v);
const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : String(v);

function toDto(r: RawRow): MissionResultDto {
  return {
    missionRunId: r.mission_run_id,
    seqNo: r.seq_no,
    goalSnippet: r.goal_snippet,
    walletAddress: r.wallet_address,
    chainId: Number(r.chain_id),
    startedAt: iso(r.started_at),
    endedAt: r.ended_at === null ? null : iso(r.ended_at),
    durationS: r.duration_s,
    bankrollStartEth: num(r.bankroll_start_eth),
    bankrollEndEth: num(r.bankroll_end_eth),
    pnlEth: num(r.pnl_eth),
    pnlPct: num(r.pnl_pct),
    ethPriceUsdStart: num(r.eth_price_usd_start),
    ethPriceUsdEnd: num(r.eth_price_usd_end),
    trades: r.trades,
    outcome: r.outcome,
    openPositionsCount: Number(r.open_positions_count ?? 0),
    stopSummary: r.stop_summary ?? null,
  };
}

/** Mission history, newest first. */
export async function listMissionResults(
  limit = 50,
): Promise<Result<MissionListResultsResult, VexError>> {
  return withClient(async (client) => {
    try {
      const result = await client.query<RawRow>(
        `SELECT r.mission_run_id, r.seq_no, r.goal_snippet, r.wallet_address, r.chain_id,
                r.started_at, r.ended_at, r.duration_s,
                r.bankroll_start_eth, r.bankroll_end_eth, r.pnl_eth, r.pnl_pct,
                r.eth_price_usd_start, r.eth_price_usd_end, r.trades, r.outcome,
                mr.stop_summary,
                (SELECT count(*) FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(r.open_positions_json) = 'array'
                        THEN r.open_positions_json ELSE '[]'::jsonb END) e
                 WHERE lower(e->>'address') NOT IN (
                   SELECT lower(s->>'address') FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(r.start_positions_json) = 'array'
                          THEN r.start_positions_json ELSE '[]'::jsonb END) s))
                  AS open_positions_count
           FROM mission_results r
           LEFT JOIN mission_runs mr ON mr.id = r.mission_run_id
          ORDER BY r.started_at DESC
          LIMIT $1`,
        [limit],
      );
      return ok(result.rows.map(toDto));
    } catch (cause) {
      log.warn("[mission-results-db] listMissionResults failed", cause);
      return err({
        code: "internal.unexpected",
        domain: "mission",
        message: "Unable to load mission history.",
        retryable: true,
        userActionable: false,
        redacted: true,
        correlationId: randomUUID(),
      });
    }
  });
}

/** Latest finalized result for a session (newest first), or null. */
export async function getSessionResult(
  sessionId: string,
): Promise<Result<MissionGetSessionResultResult, VexError>> {
  return withClient(async (client) => {
    try {
      const result = await client.query<RawRow>(
        `SELECT r.mission_run_id, r.seq_no, r.goal_snippet, r.wallet_address, r.chain_id,
                r.started_at, r.ended_at, r.duration_s,
                r.bankroll_start_eth, r.bankroll_end_eth, r.pnl_eth, r.pnl_pct,
                r.eth_price_usd_start, r.eth_price_usd_end, r.trades, r.outcome,
                mr.stop_summary,
                (SELECT count(*) FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(r.open_positions_json) = 'array'
                        THEN r.open_positions_json ELSE '[]'::jsonb END) e
                 WHERE lower(e->>'address') NOT IN (
                   SELECT lower(s->>'address') FROM jsonb_array_elements(
                     CASE WHEN jsonb_typeof(r.start_positions_json) = 'array'
                          THEN r.start_positions_json ELSE '[]'::jsonb END) s))
                  AS open_positions_count
           FROM mission_results r
           LEFT JOIN mission_runs mr ON mr.id = r.mission_run_id
          WHERE r.session_id = $1
          ORDER BY r.started_at DESC
          LIMIT 1`,
        [sessionId],
      );
      const row = result.rows[0];
      return ok(row ? toDto(row) : null);
    } catch (cause) {
      log.warn("[mission-results-db] getSessionResult failed", cause);
      return err({
        code: "internal.unexpected",
        domain: "mission",
        message: "Unable to load mission result.",
        retryable: true,
        userActionable: false,
        redacted: true,
        correlationId: randomUUID(),
      });
    }
  });
}
