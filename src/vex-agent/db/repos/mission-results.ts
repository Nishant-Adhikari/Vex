/**
 * Mission results ledger repo — open/close lifecycle + history reads.
 *
 * A row is OPENED when a mission run starts (with a per-wallet seq_no and the
 * start bankroll snapshot) and CLOSED when the run finalizes (end bankroll, PNL,
 * trade counts, outcome). Open/close key on `mission_run_id`, so the start and
 * finalize hooks — which run in different turns — address the same row without
 * holding state in memory.
 *
 * PNL is in ETH (bankroll = native ETH + WETH). See migration 038 for the model.
 */

import { query, queryOne, execute } from "../client.js";
import { nullableJsonb } from "../params.js";

export type MissionOutcome =
  | "running"
  | "completed"
  | "cancelled"
  | "failed"
  | "stopped";

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
  wins: number;
  losses: number;
  rotations: number;
  vetoes: number;
  outcome: MissionOutcome;
  openPositions: unknown;
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
}

export interface CloseMissionResultInput {
  missionRunId: string;
  outcome: Exclude<MissionOutcome, "running">;
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
  trades, wins, losses, rotations, vetoes, outcome, open_positions_json`;

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
  outcome: MissionOutcome;
  open_positions_json: unknown;
}

// pg returns NUMERIC as string to preserve precision; ETH/PNL fit safely in a
// JS number for display.
const num = (v: string | number | null): number | null =>
  v === null ? null : Number(v);

const iso = (v: Date | string): string =>
  v instanceof Date ? v.toISOString() : String(v);

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
    openPositions: r.open_positions_json,
  };
}

/**
 * Open the ledger row for a run. `seq_no` is minted as the per-wallet row count
 * + 1. Idempotent: a duplicate open for the same run is a no-op (the run-id
 * unique index + ON CONFLICT), so a retried start never double-numbers.
 */
export async function openMissionResult(
  input: OpenMissionResultInput,
): Promise<void> {
  const sql = `
    INSERT INTO mission_results (
      id, mission_id, mission_run_id, session_id, wallet_address, chain_id,
      seq_no, goal_snippet, bankroll_start_eth, eth_price_usd_start, outcome
    ) VALUES (
      $1, $2, $3, $4, $5, $6,
      (SELECT COUNT(*)+1 FROM mission_results WHERE LOWER(wallet_address) = LOWER($5)),
      $7, $8, $9, 'running'
    )
    ON CONFLICT (mission_run_id) DO NOTHING`;
  await execute(sql, [
    input.id,
    input.missionId,
    input.missionRunId,
    input.sessionId,
    input.walletAddress,
    input.chainId,
    input.goalSnippet,
    input.bankrollStartEth,
    input.ethPriceUsdStart,
  ]);
}

/** Close the ledger row at finalize. No-op if the row was never opened. */
export async function closeMissionResult(
  input: CloseMissionResultInput,
): Promise<void> {
  const sql = `
    UPDATE mission_results SET
      outcome = $2,
      ended_at = NOW(),
      duration_s = EXTRACT(EPOCH FROM (NOW() - started_at))::int,
      bankroll_end_eth = $3,
      eth_price_usd_end = $4,
      pnl_eth = $5,
      pnl_pct = $6,
      trades = $7,
      wins = $8,
      losses = $9,
      rotations = $10,
      vetoes = $11,
      open_positions_json = $12,
      updated_at = NOW()
    WHERE mission_run_id = $1`;
  await execute(sql, [
    input.missionRunId,
    input.outcome,
    input.bankrollEndEth,
    input.ethPriceUsdEnd,
    input.pnlEth,
    input.pnlPct,
    input.trades,
    input.wins,
    input.losses,
    input.rotations,
    input.vetoes,
    nullableJsonb(input.openPositions),
  ]);
}

/** Per-wallet mission history, newest first. */
export async function listResultsForWallet(
  walletAddress: string,
  limit = 50,
): Promise<MissionResultRow[]> {
  const rows = await query<Raw>(
    `SELECT ${SELECT_COLUMNS}
       FROM mission_results
      WHERE LOWER(wallet_address) = LOWER($1)
      ORDER BY seq_no DESC
      LIMIT $2`,
    [walletAddress, limit],
  );
  return rows.map(toRow);
}

/** The ledger row for a single run (null if never opened). */
export async function getResultForRun(
  missionRunId: string,
): Promise<MissionResultRow | null> {
  const row = await queryOne<Raw>(
    `SELECT ${SELECT_COLUMNS} FROM mission_results WHERE mission_run_id = $1`,
    [missionRunId],
  );
  return row ? toRow(row) : null;
}
