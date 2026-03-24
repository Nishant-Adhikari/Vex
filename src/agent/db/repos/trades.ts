import { query, queryOne, execute } from "../client.js";
import type { TradeEntry, TradeSummary } from "../../types.js";

export async function addTrade(trade: TradeEntry): Promise<void> {
  await execute(
    `INSERT INTO trades (id, type, chain, status, input_token, input_amount, input_value_usd,
       output_token, output_amount, output_value_usd, pnl_amount_usd, pnl_percent, pnl_realized,
       meta, reasoning, signature, explorer_url, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET
       type = EXCLUDED.type,
       chain = EXCLUDED.chain,
       status = EXCLUDED.status,
       input_token = EXCLUDED.input_token,
       input_amount = EXCLUDED.input_amount,
       input_value_usd = COALESCE(EXCLUDED.input_value_usd, trades.input_value_usd),
       output_token = EXCLUDED.output_token,
       output_amount = EXCLUDED.output_amount,
       output_value_usd = COALESCE(EXCLUDED.output_value_usd, trades.output_value_usd),
       pnl_amount_usd = COALESCE(EXCLUDED.pnl_amount_usd, trades.pnl_amount_usd),
       pnl_percent = COALESCE(EXCLUDED.pnl_percent, trades.pnl_percent),
       pnl_realized = COALESCE(EXCLUDED.pnl_realized, trades.pnl_realized),
       meta = trades.meta || EXCLUDED.meta,
       reasoning = COALESCE(EXCLUDED.reasoning, trades.reasoning),
       signature = COALESCE(EXCLUDED.signature, trades.signature),
       explorer_url = COALESCE(EXCLUDED.explorer_url, trades.explorer_url)`,
    [trade.id, trade.type, trade.chain, trade.status,
     trade.input.token, trade.input.amount, trade.input.valueUsd ?? null,
     trade.output.token, trade.output.amount, trade.output.valueUsd ?? null,
     trade.pnl?.amountUsd ?? null, trade.pnl?.percentChange ?? null, trade.pnl?.realized ?? null,
     JSON.stringify(trade.meta), trade.reasoning ?? null, trade.signature ?? null, trade.explorerUrl ?? null,
     trade.timestamp],
  );
}

export async function getTradeById(id: string): Promise<TradeEntry | null> {
  const row = await queryOne<Record<string, unknown>>("SELECT * FROM trades WHERE id = $1", [id]);
  return row ? rowToTrade(row) : null;
}

export async function getTrades(type?: string, limit = 50, offset = 0): Promise<{ trades: TradeEntry[]; total: number }> {
  const where = type ? "WHERE type = $1" : "";
  const params = type ? [type, limit, offset] : [limit, offset];
  const countSql = `SELECT COUNT(*) AS c FROM trades ${where}`;
  const dataSql = `SELECT * FROM trades ${where} ORDER BY created_at DESC LIMIT $${type ? 2 : 1} OFFSET $${type ? 3 : 2}`;

  const [countRes, dataRes] = await Promise.all([
    queryOne<{ c: string }>(countSql, type ? [type] : []),
    query<Record<string, unknown>>(dataSql, params),
  ]);

  return { trades: dataRes.map(rowToTrade), total: parseInt(countRes?.c ?? "0", 10) };
}

export async function getRecentTrades(count = 5): Promise<TradeEntry[]> {
  const rows = await query<Record<string, unknown>>("SELECT * FROM trades ORDER BY created_at DESC LIMIT $1", [count]);
  return rows.map(rowToTrade);
}

export async function getTradesSummary(): Promise<TradeSummary> {
  const rows = await query<Record<string, unknown>>("SELECT type, pnl_amount_usd FROM trades");
  let totalPnl = 0, wins = 0, losses = 0;
  const byType: Record<string, number> = {};
  for (const r of rows) {
    byType[r.type as string] = (byType[r.type as string] ?? 0) + 1;
    const pnl = Number(r.pnl_amount_usd ?? 0);
    totalPnl += pnl;
    if (pnl > 0) wins++;
    else if (pnl < 0) losses++;
  }
  const decided = wins + losses;
  return { totalPnlUsd: totalPnl, winCount: wins, lossCount: losses, totalTrades: rows.length, winRate: decided > 0 ? (wins / decided) * 100 : 0, byType };
}

function rowToTrade(r: Record<string, unknown>): TradeEntry {
  return {
    id: r.id as string, timestamp: r.created_at as string, type: r.type as TradeEntry["type"],
    chain: r.chain as string, status: r.status as TradeEntry["status"],
    input: { token: r.input_token as string, amount: r.input_amount as string, valueUsd: r.input_value_usd != null ? Number(r.input_value_usd) : undefined },
    output: { token: r.output_token as string, amount: r.output_amount as string, valueUsd: r.output_value_usd != null ? Number(r.output_value_usd) : undefined },
    pnl: r.pnl_amount_usd != null ? { amountUsd: Number(r.pnl_amount_usd), percentChange: Number(r.pnl_percent ?? 0), realized: r.pnl_realized as boolean } : undefined,
    meta: (r.meta as Record<string, unknown>) ?? {}, reasoning: r.reasoning as string | undefined,
    signature: r.signature as string | undefined, explorerUrl: r.explorer_url as string | undefined,
  };
}
