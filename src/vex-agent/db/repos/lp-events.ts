/**
 * LP events repo — proj_lp_events + proj_lp_event_legs.
 *
 * Multi-leg cashflow tracking for liquidity positions.
 * Projection table — included in replay truncate cycle.
 */

import { query, queryOne } from "../client.js";

export interface LpEventInsert {
  executionId: number;
  captureItemId: number | null;
  namespace: string;
  chain: string;
  action: string;
  dex?: string;
  pool?: string;
  positionKey?: string;
  instrumentKey?: string;
  walletAddress: string;
  totalValueUsd?: string;
  feeCollectedUsd?: string;
  valuationSource?: string;
}

export interface LpLegInsert {
  lpEventId: number;
  legType: "deposit" | "withdraw" | "fee" | "refund";
  tokenAddress: string;
  tokenSymbol?: string;
  amountRaw: string;
  amountUsd?: string;
}

export interface LpEvent {
  id: number;
  executionId: number;
  captureItemId: number | null;
  namespace: string;
  chain: string;
  action: string;
  dex: string | null;
  pool: string | null;
  positionKey: string | null;
  instrumentKey: string | null;
  walletAddress: string;
  totalValueUsd: string | null;
  feeCollectedUsd: string | null;
  valuationSource: string | null;
  createdAt: string;
}

export interface LpLeg {
  id: number;
  lpEventId: number;
  legType: string;
  tokenAddress: string;
  tokenSymbol: string | null;
  amountRaw: string;
  amountUsd: string | null;
}

export async function insertLpEvent(row: LpEventInsert): Promise<number> {
  const result = await queryOne<{ id: number }>(
    `INSERT INTO proj_lp_events
       (execution_id, capture_item_id, namespace, chain, action, dex, pool,
        position_key, instrument_key, wallet_address, total_value_usd, fee_collected_usd, valuation_source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id`,
    [
      row.executionId, row.captureItemId, row.namespace, row.chain, row.action,
      row.dex ?? null, row.pool ?? null, row.positionKey ?? null, row.instrumentKey ?? null,
      row.walletAddress, row.totalValueUsd ?? null, row.feeCollectedUsd ?? null,
      row.valuationSource ?? null,
    ],
  );
  return result?.id ?? 0;
}

export async function insertLpLegs(legs: LpLegInsert[]): Promise<void> {
  for (const leg of legs) {
    await queryOne(
      `INSERT INTO proj_lp_event_legs (lp_event_id, leg_type, token_address, token_symbol, amount_raw, amount_usd)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [leg.lpEventId, leg.legType, leg.tokenAddress, leg.tokenSymbol ?? null, leg.amountRaw, leg.amountUsd ?? null],
    );
  }
}

export async function getLpEventsByPosition(positionKey: string): Promise<LpEvent[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM proj_lp_events WHERE position_key = $1 ORDER BY created_at ASC",
    [positionKey],
  );
  return rows.map(mapEvent);
}

export async function getLpLegsByEvent(eventId: number): Promise<LpLeg[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM proj_lp_event_legs WHERE lp_event_id = $1 ORDER BY id ASC",
    [eventId],
  );
  return rows.map(mapLeg);
}

function mapEvent(r: Record<string, unknown>): LpEvent {
  return {
    id: r.id as number,
    executionId: r.execution_id as number,
    captureItemId: r.capture_item_id as number | null,
    namespace: r.namespace as string,
    chain: r.chain as string,
    action: r.action as string,
    dex: r.dex as string | null,
    pool: r.pool as string | null,
    positionKey: r.position_key as string | null,
    instrumentKey: r.instrument_key as string | null,
    walletAddress: r.wallet_address as string,
    totalValueUsd: r.total_value_usd != null ? String(r.total_value_usd) : null,
    feeCollectedUsd: r.fee_collected_usd != null ? String(r.fee_collected_usd) : null,
    valuationSource: r.valuation_source as string | null,
    createdAt: r.created_at as string,
  };
}

function mapLeg(r: Record<string, unknown>): LpLeg {
  return {
    id: r.id as number,
    lpEventId: r.lp_event_id as number,
    legType: r.leg_type as string,
    tokenAddress: r.token_address as string,
    tokenSymbol: r.token_symbol as string | null,
    amountRaw: r.amount_raw as string,
    amountUsd: r.amount_usd != null ? String(r.amount_usd) : null,
  };
}
