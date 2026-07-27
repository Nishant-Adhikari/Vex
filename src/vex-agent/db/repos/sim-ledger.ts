/**
 * Shadow-ledger repo — persistence for the mission simulator's paper trades
 * and positions (`sim_trades` / `sim_positions`, migration 044).
 *
 * FULLY ISOLATED from the real wallet/balance/PnL tables: every row is keyed by
 * `mission_run_id` so a simulator run's paper portfolio can never affect — or be
 * affected by — a real mission's projections, `runner_leases`, or wallet
 * balances. Nothing in here reads or writes any real-money table.
 *
 * `recordSimFill` is the single write entry point: it reads the current shadow
 * position under a row lock, applies the pure `applySimFill` accounting, upserts
 * the position, and inserts the trade — all in one transaction so a position and
 * its trade are always consistent.
 */

import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, withTransaction } from "../client.js";
import {
  applySimFill,
  EMPTY_SIM_POSITION,
  type SimPositionState,
  type SimSwapFill,
} from "../../sim/paper-fill.js";

export interface SimTradeRow {
  id: string;
  missionRunId: string;
  sessionId: string;
  chain: string;
  dex: string;
  side: "buy" | "sell";
  tokenAddress: string;
  tokenSymbol: string;
  tokenQty: number;
  nativeValue: number | null;
  priceImpact: number | null;
  realizedPnlNative: number | null;
  createdAt: string;
}

export interface SimPositionRow {
  id: string;
  missionRunId: string;
  sessionId: string;
  chain: string;
  tokenAddress: string;
  tokenSymbol: string;
  qty: number;
  costNative: number;
  realizedPnlNative: number;
  status: "open" | "closed";
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v);
  return 0;
}

function nullableNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return num(v);
}

export interface RecordSimFillResult {
  readonly trade: SimTradeRow;
  readonly position: SimPositionState;
  readonly realizedDelta: number;
  readonly closed: boolean;
}

async function readPositionForUpdate(
  client: PoolClient,
  missionRunId: string,
  chain: string,
  tokenAddress: string,
): Promise<{ id: string; state: SimPositionState } | null> {
  const res = await client.query(
    `SELECT id, qty, cost_native, realized_pnl_native
       FROM sim_positions
      WHERE mission_run_id = $1 AND chain = $2 AND LOWER(token_address) = LOWER($3)
      FOR UPDATE`,
    [missionRunId, chain, tokenAddress],
  );
  const r = res.rows[0];
  if (!r) return null;
  return {
    id: r.id as string,
    state: {
      qty: num(r.qty),
      costNative: num(r.cost_native),
      realizedPnlNative: num(r.realized_pnl_native),
    },
  };
}

/**
 * Record a paper-filled swap leg: upsert the shadow position and insert the
 * trade, atomically. Returns the resulting position state + realized PnL delta.
 */
export async function recordSimFill(input: {
  missionRunId: string;
  sessionId: string;
  fill: SimSwapFill;
}): Promise<RecordSimFillResult> {
  const { missionRunId, sessionId, fill } = input;
  return withTransaction(async (client) => {
    const existing = await readPositionForUpdate(
      client,
      missionRunId,
      fill.chain,
      fill.tokenAddress,
    );
    const prev = existing?.state ?? EMPTY_SIM_POSITION;
    const update = applySimFill(prev, fill);

    if (existing) {
      await client.query(
        `UPDATE sim_positions
            SET qty = $2, cost_native = $3, realized_pnl_native = $4,
                status = $5, updated_at = NOW()
          WHERE id = $1`,
        [
          existing.id,
          update.next.qty,
          update.next.costNative,
          update.next.realizedPnlNative,
          update.closed ? "closed" : "open",
          ],
      );
    } else {
      await client.query(
        `INSERT INTO sim_positions
           (id, mission_run_id, session_id, chain, token_address, token_symbol,
            qty, cost_native, realized_pnl_native, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          missionRunId,
          sessionId,
          fill.chain,
          fill.tokenAddress,
          fill.tokenSymbol,
          update.next.qty,
          update.next.costNative,
          update.next.realizedPnlNative,
          update.closed ? "closed" : "open",
        ],
      );
    }

    const tradeId = randomUUID();
    const signedQty = fill.side === "buy" ? fill.tokenQty : -fill.tokenQty;
    const tradeRes = await client.query(
      `INSERT INTO sim_trades
         (id, mission_run_id, session_id, chain, dex, side,
          token_address, token_symbol, token_qty, native_value, price_impact,
          realized_pnl_native)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING created_at`,
      [
        tradeId,
        missionRunId,
        sessionId,
        fill.chain,
        fill.dex,
        fill.side,
        fill.tokenAddress,
        fill.tokenSymbol,
        signedQty,
        fill.nativeValue,
        fill.priceImpact,
        fill.side === "sell" ? update.realizedDelta : null,
      ],
    );

    const createdAt = tradeRes.rows[0]?.created_at;
    const trade: SimTradeRow = {
      id: tradeId,
      missionRunId,
      sessionId,
      chain: fill.chain,
      dex: fill.dex,
      side: fill.side,
      tokenAddress: fill.tokenAddress,
      tokenSymbol: fill.tokenSymbol,
      tokenQty: signedQty,
      nativeValue: fill.nativeValue,
      priceImpact: fill.priceImpact,
      realizedPnlNative: fill.side === "sell" ? update.realizedDelta : null,
      createdAt:
        createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    };

    return {
      trade,
      position: update.next,
      realizedDelta: update.realizedDelta,
      closed: update.closed,
    };
  });
}

/** All shadow trades for a run, oldest first. */
export async function listSimTradesForRun(missionRunId: string): Promise<SimTradeRow[]> {
  const rows = await query(
    `SELECT * FROM sim_trades WHERE mission_run_id = $1 ORDER BY created_at ASC`,
    [missionRunId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    missionRunId: r.mission_run_id as string,
    sessionId: r.session_id as string,
    chain: r.chain as string,
    dex: r.dex as string,
    side: r.side as "buy" | "sell",
    tokenAddress: r.token_address as string,
    tokenSymbol: r.token_symbol as string,
    tokenQty: num(r.token_qty),
    nativeValue: nullableNum(r.native_value),
    priceImpact: nullableNum(r.price_impact),
    realizedPnlNative: nullableNum(r.realized_pnl_native),
    createdAt:
      r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  }));
}

/** All shadow positions for a run. */
export async function listSimPositionsForRun(missionRunId: string): Promise<SimPositionRow[]> {
  const rows = await query(
    `SELECT * FROM sim_positions WHERE mission_run_id = $1 ORDER BY opened_at ASC`,
    [missionRunId],
  );
  return rows.map((r) => ({
    id: r.id as string,
    missionRunId: r.mission_run_id as string,
    sessionId: r.session_id as string,
    chain: r.chain as string,
    tokenAddress: r.token_address as string,
    tokenSymbol: r.token_symbol as string,
    qty: num(r.qty),
    costNative: num(r.cost_native),
    realizedPnlNative: num(r.realized_pnl_native),
    status: r.status as "open" | "closed",
  }));
}

/** Total realized paper PnL (native) across a run's shadow positions. */
export async function sumRealizedPnlForRun(missionRunId: string): Promise<number> {
  const rows = await query<{ total: string | null }>(
    `SELECT COALESCE(SUM(realized_pnl_native), 0) AS total
       FROM sim_positions WHERE mission_run_id = $1`,
    [missionRunId],
  );
  return num(rows[0]?.total ?? 0);
}
