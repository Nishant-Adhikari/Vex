/**
 * Portfolio inspection — DB-backed read-only views over the agent's own
 * positions, activity, executions, balances, snapshots, lots, profits.
 */

import type { ToolDef } from "../types.js";

export const PORTFOLIO_TOOLS: readonly ToolDef[] = [
  {
    name: "portfolio_inspect", kind: "internal", mutating: false,
    description: "Inspect your own portfolio state — open positions, activity, executions, balances, snapshots, summary, lots, profits, closed_positions, non_trading_history, bridges, lp_history, orders, unrealized. DB-backed, read-only.",
    parameters: { type: "object", properties: {
      view: { type: "string", enum: ["open_positions", "activity", "executions", "balances", "snapshots", "summary", "lots", "profits", "closed_positions", "non_trading_history", "bridges", "lp_history", "orders", "unrealized"], description: "What to inspect" },
      namespace: { type: "string", description: "Protocol filter (e.g. solana, khalani)" },
      productType: { type: "string", description: "Product filter (e.g. spot, perps, prediction)" },
      instrumentKey: { type: "string", description: "Instrument filter (lots, profits)" },
      walletAddress: { type: "string", description: "Wallet filter (profits)" },
      status: { type: "string", description: "Status filter (lots, orders)" },
      groupBy: { type: "string", enum: ["instrument", "namespace"], description: "Group by for profits (default: instrument)" },
      limit: { type: "number", description: "Max rows (default 20)" },
    }, required: ["view"] },
  },
];
