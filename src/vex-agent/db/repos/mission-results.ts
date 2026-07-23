/**
 * Mission results ledger repo — open/close lifecycle + per-wallet history
 * reads.
 *
 * A row is OPENED when a mission run starts (with a per-wallet `seq_no` and
 * the start bankroll snapshot) and CLOSED when the run finalizes (end
 * bankroll, PnL, trade count, outcome, raw stop_reason). Open/close key on
 * `mission_run_id`, so the start and finalize hooks — which run in
 * different turns — address the same row without holding state in memory.
 *
 * `seq_no` is minted under a transaction-scoped Postgres advisory lock keyed
 * on the wallet address, so two concurrent opens for the SAME wallet can
 * never mint the same number (a bare `SELECT COUNT(*)+1` here would race).
 *
 * PnL is in ETH (bankroll = native ETH + WETH). See migration 041.
 */

import type pg from "pg";
import { query, queryOne, queryOneWith, execute, executeWith, withTransaction } from "../client.js";
import { nullableJsonb } from "../params.js";

export type MissionResultOutcome = "running" | "completed" | "cancelled" | "failed" | "stopped";

export interface MissionResultRow {
  id: string;
  missionId: string;
  missionRunId: string;
  sessionId: string;
  walletAddress: string;
  chainId: number;
  seqNo: number;
  goalSnippet: string | null;
  startedAt: string;
  endedAt: string | null;
  durationS: number | null;
  bankrollStartEth: number | null;
  bankrollEndEth: number | null;
  pnlEth: number | null;
  pnlPct: number | null;
  ethPriceUsdStart: number | null;
  ethPriceUsdEnd: number | null;
  trades: number;
  // Per-trade attribution counters (fork extras, migration 042).
  wins: number;
  losses: number;
  rotations: number;
  vetoes: number;
  outcome: MissionResultOutcome;
  stopReason: string | null;
  /**
   * The run's persisted `stop_summary` (from `mission_runs`, joined in by the
   * renderer-facing reads only) — the operator-facing "why it ended" prose the
   * finalize path records alongside the raw stop reason. Null when no summary
   * was stored, or when the read did not join it (e.g. `getResultByRunId`).
   */
  summary: string | null;
  openPositions: unknown;
  /**
   * Bags held at run START (pre-existing dust captured at open). Used by the
   * deadline force-liquidator to attribute which current holdings the mission
   * itself opened (current non-ETH holdings MINUS these) so it never sells a
   * pre-existing position. Null when no start snapshot was recorded.
   */
  startPositions: unknown;
}

export interface OpenMissionResultInput {
  id: string;
  missionId: string;
  missionRunId: string;
  sessionId: string;
  walletAddress: string;
  chainId: number;
  goalSnippet: string | null;
  bankrollStartEth: number | null;
  ethPriceUsdStart: number | null;
  startPositions: unknown;
}

export interface CloseMissionResultInput {
  missionRunId: string;
  outcome: Exclude<MissionResultOutcome, "running">;
  stopReason: string | null;
  bankrollEndEth: number | null;
  ethPriceUsdEnd: number | null;
  pnlEth: number | null;
  pnlPct: number | null;
  trades: number;
  wins: number;
  losses: number;
  rotations: number;
  vetoes: number;
  openPositions: unknown;
}

const SELECT_COLUMNS = `
  id, mission_id, mission_run_id, session_id, wallet_address, chain_id, seq_no,
  goal_snippet, started_at, ended_at, duration_s,
  bankroll_start_eth, bankroll_end_eth, pnl_eth, pnl_pct,
  eth_price_usd_start, eth_price_usd_end,
  trades, wins, losses, rotations, vetoes,
  outcome, stop_reason, open_positions_json, start_positions_json`;

// The "why it ended" summary lives on `mission_runs.stop_summary` (written by
// the finalize path), NOT on the ledger row — there is no summary column on
// `mission_results`. A correlated subselect joins it in for the renderer-facing
// reads WITHOUT a table JOIN, so the unqualified `SELECT_COLUMNS` above stay
// unambiguous and no migration is needed. Aliased to `stop_summary` so `toRow`
// reads it the same way regardless of query.
const STOP_SUMMARY_SUBSELECT = `
  (SELECT r.stop_summary FROM mission_runs r
    WHERE r.id = mission_results.mission_run_id) AS stop_summary`;

interface Raw {
  id: string;
  mission_id: string;
  mission_run_id: string;
  session_id: string;
  wallet_address: string;
  chain_id: string | number;
  seq_no: number;
  goal_snippet: string | null;
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
  wins: number;
  losses: number;
  rotations: number;
  vetoes: number;
  outcome: MissionResultOutcome;
  stop_reason: string | null;
  // Joined from `mission_runs.stop_summary` by the renderer-facing reads only;
  // absent (undefined) on reads that do not select it.
  stop_summary?: string | null;
  open_positions_json: unknown;
  start_positions_json: unknown;
}

// pg returns NUMERIC as string to preserve precision; ETH/PnL fit safely in
// a JS number for display.
const num = (v: string | number | null): number | null => (v === null ? null : Number(v));

const iso = (v: Date | string): string => (v instanceof Date ? v.toISOString() : String(v));

function toRow(r: Raw): MissionResultRow {
  return {
    id: r.id,
    missionId: r.mission_id,
    missionRunId: r.mission_run_id,
    sessionId: r.session_id,
    walletAddress: r.wallet_address,
    chainId: Number(r.chain_id),
    seqNo: r.seq_no,
    goalSnippet: r.goal_snippet,
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
    wins: r.wins,
    losses: r.losses,
    rotations: r.rotations,
    vetoes: r.vetoes,
    outcome: r.outcome,
    stopReason: r.stop_reason,
    summary: r.stop_summary ?? null,
    openPositions: r.open_positions_json,
    startPositions: r.start_positions_json,
  };
}

/**
 * Open the ledger row for a run. `seq_no` is minted as `MAX(seq_no)+1` for
 * the wallet, under a transaction-scoped advisory lock keyed on the
 * (lowercased) wallet address — a concurrent open for a DIFFERENT wallet
 * proceeds independently; a concurrent open for the SAME wallet blocks at
 * the lock until the first transaction commits, so the two can never mint
 * the same number. The lock releases automatically at COMMIT/ROLLBACK.
 *
 * Idempotent: a duplicate open for the same run is a no-op (the run-id
 * unique index + `ON CONFLICT`), so a retried start never double-numbers.
 */
export async function openMissionResult(input: OpenMissionResultInput): Promise<void> {
  await withTransaction(async (client: pg.PoolClient) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
      missionResultsSeqLockKey(input.walletAddress),
    ]);
    const next = await queryOneWith<{ next_seq: string }>(
      client,
      `SELECT (COALESCE(MAX(seq_no), 0) + 1)::text AS next_seq
         FROM mission_results
        WHERE LOWER(wallet_address) = LOWER($1)`,
      [input.walletAddress],
    );
    const seqNo = Number(next?.next_seq ?? "1");
    const sql = `
      INSERT INTO mission_results (
        id, mission_id, mission_run_id, session_id, wallet_address, chain_id,
        seq_no, goal_snippet, bankroll_start_eth, eth_price_usd_start,
        start_positions_json, outcome
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'running')
      ON CONFLICT (mission_run_id) DO NOTHING`;
    await executeWith(client, sql, [
      input.id,
      input.missionId,
      input.missionRunId,
      input.sessionId,
      input.walletAddress,
      input.chainId,
      seqNo,
      input.goalSnippet,
      input.bankrollStartEth,
      input.ethPriceUsdStart,
      // `startPositions` is an optional snapshot ("null when no start snapshot
      // was recorded"): normalise a JS `undefined` (omitted field) to null so
      // the strict jsonb serializer records a null column instead of throwing.
      nullableJsonb(input.startPositions ?? null),
    ]);
  });
}

/** Stable advisory-lock key for per-wallet seq_no minting (see openMissionResult). */
function missionResultsSeqLockKey(walletAddress: string): string {
  return `mission_results_seq:${walletAddress.toLowerCase()}`;
}

/** Close the ledger row at finalize. No-op if the row was never opened. */
export async function closeMissionResult(input: CloseMissionResultInput): Promise<void> {
  const sql = `
    UPDATE mission_results SET
      outcome = $2,
      stop_reason = $3,
      ended_at = NOW(),
      duration_s = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
      bankroll_end_eth = $4,
      eth_price_usd_end = $5,
      pnl_eth = $6,
      pnl_pct = $7,
      trades = $8,
      wins = $9,
      losses = $10,
      rotations = $11,
      vetoes = $12,
      open_positions_json = $13,
      updated_at = NOW()
    WHERE mission_run_id = $1`;
  await execute(sql, [
    input.missionRunId,
    input.outcome,
    input.stopReason,
    input.bankrollEndEth,
    input.ethPriceUsdEnd,
    input.pnlEth,
    input.pnlPct,
    input.trades,
    input.wins,
    input.losses,
    input.rotations,
    input.vetoes,
    // Same optional-snapshot semantics as startPositions: an omitted
    // `openPositions` (undefined) records a null column rather than throwing at
    // finalize — mission finalization must never fail on bankroll accounting.
    nullableJsonb(input.openPositions ?? null),
  ]);
}

/** Per-wallet mission history, newest first. */
export async function listResultsForWallet(
  walletAddress: string,
  limit = 50,
): Promise<MissionResultRow[]> {
  const rows = await query<Raw>(
    `SELECT ${SELECT_COLUMNS}, ${STOP_SUMMARY_SUBSELECT}
       FROM mission_results
      WHERE LOWER(wallet_address) = LOWER($1)
      ORDER BY seq_no DESC
      LIMIT $2`,
    [walletAddress, limit],
  );
  return rows.map(toRow);
}

/** The ledger row for a single run and wallet (null if never opened or not owned by that wallet). */
export async function getResultForRun(
  missionRunId: string,
  walletAddress: string,
): Promise<MissionResultRow | null> {
  const row = await queryOne<Raw>(
    `SELECT ${SELECT_COLUMNS}, ${STOP_SUMMARY_SUBSELECT}
       FROM mission_results
      WHERE mission_run_id = $1
        AND LOWER(wallet_address) = LOWER($2)`,
    [missionRunId, walletAddress],
  );
  return row ? toRow(row) : null;
}

/**
 * The ledger row for a single run, keyed on the run id ALONE (null if the run
 * never opened a result). `mission_run_id` is UNIQUE (see `openMissionResult`'s
 * `ON CONFLICT (mission_run_id)`), so this returns at most one row. Used by the
 * deadline force-liquidator, which must READ the row to DISCOVER the mission's
 * wallet/chain (safety contract #3) — it has the run id but not yet the wallet,
 * so the wallet-scoped `getResultForRun` cannot serve it.
 */
export async function getResultByRunId(
  missionRunId: string,
): Promise<MissionResultRow | null> {
  const row = await queryOne<Raw>(
    `SELECT ${SELECT_COLUMNS}
       FROM mission_results
      WHERE mission_run_id = $1`,
    [missionRunId],
  );
  return row ? toRow(row) : null;
}

/**
 * The newest ledger row for a session (null if the session never opened a
 * mission result). A session maps 1:1 to a mission run, but the renderer's
 * post-mission summary card only has the session id in hand — this is the
 * session-keyed sibling of `getResultForRun`. Ordered by seq_no DESC so the
 * latest run for the session wins if more than one row ever shares it.
 */
export async function getSessionResult(
  sessionId: string,
): Promise<MissionResultRow | null> {
  const row = await queryOne<Raw>(
    `SELECT ${SELECT_COLUMNS}, ${STOP_SUMMARY_SUBSELECT}
       FROM mission_results
      WHERE session_id = $1
      ORDER BY seq_no DESC
      LIMIT 1`,
    [sessionId],
  );
  return row ? toRow(row) : null;
}
