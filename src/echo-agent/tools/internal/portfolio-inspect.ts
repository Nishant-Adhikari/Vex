/**
 * Portfolio inspect — DB-backed read-only self-inspection tool.
 *
 * Lets the agent inspect its own protocol history, open positions,
 * activity, executions, balances, and portfolio snapshots from
 * existing projection tables.
 *
 * Does NOT fabricate PnL — surfaces "not_available_yet" where
 * realized/unrealized profit reconciliation is incomplete.
 *
 * Repo signatures (verified 2026-03-29):
 *   open-positions: getOpen(walletAddress?, namespace?) → Position[]
 *   activity: getActivities({ walletAddress?, namespace?, productType?, limit? }) → Activity[]
 *   executions: getByNamespace(namespace, limit=50) → ExecutionRecord[]
 *   balances: getTotalUsd() → number
 *   balances: getLatestSnapshot() → PortfolioSnapshot | null
 *   balances: getSnapshotHistory("24h"|"7d"|"30d"|"all") → PortfolioSnapshot[]
 */

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num, ok, fail } from "./types.js";

const VALID_VIEWS = new Set<string>([
  "open_positions", "activity", "executions", "balances", "snapshots", "summary",
]);

export async function handlePortfolioInspect(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const view = str(params, "view");
  if (!view || !VALID_VIEWS.has(view)) {
    return fail(`Invalid view "${view}". Must be one of: ${[...VALID_VIEWS].join(", ")}`);
  }

  const namespace = str(params, "namespace") || undefined;
  const productType = str(params, "productType") || undefined;
  const limit = num(params, "limit") ?? 20;

  switch (view) {
    case "open_positions": return inspectOpenPositions(namespace);
    case "activity": return inspectActivity(namespace, productType, limit);
    case "executions": return inspectExecutions(namespace, limit);
    case "balances": return inspectBalances();
    case "snapshots": return inspectSnapshots();
    case "summary": return inspectSummary();
    default: return fail(`Unknown view: ${view}`);
  }
}

// ── View handlers ───────────────────────────────────────────────

async function inspectOpenPositions(namespace?: string): Promise<ToolResult> {
  const { getOpen } = await import("@echo-agent/db/repos/open-positions.js");
  const positions = await getOpen(undefined, namespace);

  if (positions.length === 0) {
    return ok({ view: "open_positions", count: 0, positions: [], note: "No open positions found" });
  }

  return ok({
    view: "open_positions",
    count: positions.length,
    positions: positions.map(p => ({
      namespace: p.namespace,
      type: p.positionType,
      chain: p.chain,
      wallet: p.walletAddress,
      instrument: p.instrumentKey,
      positionKey: p.positionKey,
      entryPrice: p.entryPriceUsd,
      currentValue: p.currentValueUsd,
      unrealizedPnl: p.unrealizedPnlUsd ?? "not_available_yet",
      status: p.status,
      openedAt: p.openedAt,
    })),
  });
}

async function inspectActivity(namespace?: string, productType?: string, limit = 20): Promise<ToolResult> {
  const { getActivities } = await import("@echo-agent/db/repos/activity.js");
  const activities = await getActivities({ namespace, productType, limit });

  return ok({
    view: "activity",
    count: activities.length,
    activities: activities.map(a => ({
      namespace: a.namespace,
      type: a.activityType,
      product: a.productType,
      side: a.tradeSide,
      chain: a.chain,
      input: a.inputToken ? `${a.inputAmount} ${a.inputToken}` : null,
      output: a.outputToken ? `${a.outputAmount} ${a.outputToken}` : null,
      valueUsd: a.valueUsd,
      captureStatus: a.captureStatus,
      createdAt: a.createdAt,
    })),
  });
}

async function inspectExecutions(namespace?: string, limit = 20): Promise<ToolResult> {
  const { getByNamespace } = await import("@echo-agent/db/repos/executions.js");
  if (!namespace) {
    return fail("executions view requires namespace filter");
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

async function inspectBalances(): Promise<ToolResult> {
  const { getTotalUsd } = await import("@echo-agent/db/repos/balances.js");
  const totalUsd = await getTotalUsd();

  return ok({
    view: "balances",
    totalUsd,
    note: "Use wallet_read for detailed per-token balances. This shows aggregate USD total from projections.",
  });
}

async function inspectSnapshots(): Promise<ToolResult> {
  const { getSnapshotHistory } = await import("@echo-agent/db/repos/balances.js");
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

async function inspectSummary(): Promise<ToolResult> {
  const { getTotalUsd } = await import("@echo-agent/db/repos/balances.js");
  const { getOpen } = await import("@echo-agent/db/repos/open-positions.js");
  const { getLatestSnapshot } = await import("@echo-agent/db/repos/balances.js");

  const totalUsd = await getTotalUsd();
  const openPositions = await getOpen();
  const latestSnapshot = await getLatestSnapshot();

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
    realizedPnl: "not_available_yet",
    unrealizedPnl: "not_available_yet",
    note: "Full PnL reconciliation not yet implemented. Open positions and balances are accurate.",
  });
}
