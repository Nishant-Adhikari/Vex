/**
 * Portfolio inspect — portfolio views: summary, balances, snapshots, executions.
 * Aggregate portfolio state and audit.
 */

import type { ToolResult } from "../../types.js";
import { ok } from "../types.js";

export async function inspectSummary(): Promise<ToolResult> {
  const { getTotalUsd } = await import("@vex-agent/db/repos/balances.js");
  const { getOpen } = await import("@vex-agent/db/repos/open-positions.js");
  const { getLatestSnapshot } = await import("@vex-agent/db/repos/balances.js");
  const { getTotalRealizedPnl } = await import("@vex-agent/db/repos/pnl-matches.js");
  const { query: dbQuery } = await import("@vex-agent/db/client.js");

  const totalUsd = await getTotalUsd();
  const openPositions = await getOpen();
  const latestSnapshot = await getLatestSnapshot();
  const realizedPnlRaw = await getTotalRealizedPnl();

  let unrealizedPnlUsd: number | null = null;

  const mtmRow = await dbQuery<{ total: string | null }>(
    "SELECT SUM(unrealized_pnl_usd) AS total FROM proj_open_positions WHERE status = 'open' AND unrealized_pnl_usd IS NOT NULL",
    [],
  );
  const predictionUnrealized = mtmRow[0]?.total != null ? Number(mtmRow[0].total) : null;

  const spotRow = await dbQuery<{ total: string | null }>(
    `WITH lot_vals AS (
       SELECT l.cost_basis_usd * l.remaining_quantity_raw::numeric / l.quantity_raw::numeric AS remaining_cost,
              l.remaining_quantity_raw::numeric / power(10, COALESCE(b.decimals, 18)) * b.price_usd AS current_val
       FROM proj_pnl_lots l
       LEFT JOIN proj_balances b ON b.wallet_address = l.wallet_address
         AND b.token_address = split_part(l.instrument_key, ':', 2)
       WHERE l.status IN ('open', 'partial') AND b.price_usd IS NOT NULL AND l.cost_basis_usd IS NOT NULL
     )
     SELECT SUM(current_val - remaining_cost) AS total FROM lot_vals`,
    [],
  );
  const spotUnrealized = spotRow[0]?.total != null ? Number(spotRow[0].total) : null;

  if (predictionUnrealized != null || spotUnrealized != null) {
    unrealizedPnlUsd = (predictionUnrealized ?? 0) + (spotUnrealized ?? 0);
  }

  return ok({
    view: "summary",
    totalBalanceUsd: totalUsd,
    openPositionCount: openPositions.length,
    latestSnapshot: latestSnapshot ? {
      totalUsd: latestSnapshot.totalUsd,
      pnlVsPrev: latestSnapshot.pnlVsPrev,
      activeChains: latestSnapshot.activeChains,
      at: latestSnapshot.createdAt,
    } : null,
    realizedPnlUsd: realizedPnlRaw != null ? Number(realizedPnlRaw) : null,
    unrealizedPnlUsd,
    note: "Realized PnL from FIFO lot matching. Unrealized from prediction MTM + spot lots × current prices. Use 'unrealized' view for per-instrument detail.",
  });
}

export async function inspectBalances(): Promise<ToolResult> {
  const { getTotalUsd } = await import("@vex-agent/db/repos/balances.js");
  const totalUsd = await getTotalUsd();

  return ok({
    view: "balances",
    totalUsd,
    note: "Use wallet_read for fresh per-token live balances. This shows aggregate USD total from DB projections.",
  });
}

export async function inspectSnapshots(): Promise<ToolResult> {
  const { getSnapshotHistory } = await import("@vex-agent/db/repos/balances.js");
  const snapshots = await getSnapshotHistory("7d");

  return ok({
    view: "snapshots",
    count: snapshots.length,
    snapshots: snapshots.map(s => ({
      totalUsd: s.totalUsd,
      pnlVsPrev: s.pnlVsPrev,
      pnlPctVsPrev: s.pnlPctVsPrev,
      activeChains: s.activeChains,
      createdAt: s.createdAt,
    })),
  });
}

export async function inspectExecutions(namespace?: string, limit = 20): Promise<ToolResult> {
  const { getByNamespace } = await import("@vex-agent/db/repos/executions.js");
  if (!namespace) {
    const { query } = await import("@vex-agent/db/client.js");
    const rows = await query<Record<string, unknown>>(
      "SELECT id, tool_id, namespace, success, external_refs, duration_ms, created_at FROM protocol_executions ORDER BY created_at DESC LIMIT $1",
      [limit],
    );
    return ok({
      view: "executions",
      count: rows.length,
      executions: rows.map(e => ({
        id: e.id,
        toolId: e.tool_id,
        namespace: e.namespace,
        success: e.success,
        externalRefs: e.external_refs,
        durationMs: e.duration_ms,
        createdAt: e.created_at,
      })),
    });
  }
  const executions = await getByNamespace(namespace, limit);

  return ok({
    view: "executions",
    count: executions.length,
    executions: executions.map(e => ({
      toolId: e.toolId,
      success: e.success,
      externalRefs: e.externalRefs,
      durationMs: e.durationMs,
      createdAt: e.createdAt,
    })),
  });
}
