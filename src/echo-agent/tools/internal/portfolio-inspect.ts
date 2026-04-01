/**
 * Portfolio inspect — DB-backed read-only self-inspection tool.
 *
 * 14 views across 4 families:
 *   Trading: lots, profits, unrealized
 *   Positions: open_positions, closed_positions, orders
 *   Activity: activity, bridges, lp_history, non_trading_history
 *   Portfolio: summary, balances, snapshots, executions
 *
 * View implementations in inspect-views/*.ts — this file is the router only.
 */

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num, fail } from "./types.js";

// Trading views
import { inspectLots, inspectProfits, inspectUnrealized } from "./inspect-views/trading.js";
// Position views
import { inspectOpenPositions, inspectClosedPositions, inspectOrders } from "./inspect-views/positions.js";
// Activity views
import { inspectActivity, inspectBridges, inspectLpHistory, inspectNonTradingHistory } from "./inspect-views/activity.js";
// Portfolio views
import { inspectSummary, inspectBalances, inspectSnapshots, inspectExecutions } from "./inspect-views/portfolio.js";

const VALID_VIEWS = new Set<string>([
  "open_positions", "activity", "executions", "balances", "snapshots", "summary",
  "lots", "profits", "closed_positions", "non_trading_history",
  "bridges", "lp_history", "orders", "unrealized",
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
    // Position views
    case "open_positions": return inspectOpenPositions(namespace);
    case "closed_positions": return inspectClosedPositions(namespace);
    case "orders": return inspectOrders(namespace, str(params, "status") || undefined);
    // Trading views
    case "lots": return inspectLots(str(params, "instrumentKey") || undefined, namespace, str(params, "status") || undefined);
    case "profits": return inspectProfits(str(params, "walletAddress") || undefined, namespace, str(params, "instrumentKey") || undefined, str(params, "groupBy") || undefined);
    case "unrealized": return inspectUnrealized(namespace);
    // Activity views
    case "activity": return inspectActivity(namespace, productType, limit);
    case "bridges": return inspectBridges(namespace, limit);
    case "lp_history": return inspectLpHistory(namespace, limit);
    case "non_trading_history": return inspectNonTradingHistory(namespace, limit);
    // Portfolio views
    case "summary": return inspectSummary();
    case "balances": return inspectBalances();
    case "snapshots": return inspectSnapshots();
    case "executions": return inspectExecutions(namespace, limit);
    default: return fail(`Unknown view: ${view}`);
  }
}
