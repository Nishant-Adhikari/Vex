/**
 * Portfolio inspection — DB-backed read-only views over the agent's own
 * positions, activity, executions, balances, snapshots, lots, profits.
 */

import type { ToolDef } from "../types.js";

export const PORTFOLIO_TOOLS: readonly ToolDef[] = [
  {
    name: "portfolio", kind: "internal", mutating: false, pressureSafety: "read_only", actionKind: "read",
    description: [
      "Read-only view over your own portfolio state, materialized from DB projections — NOT live RPC. The agent owns this surface; do not query third parties for the same data.",
      "View groups (pick one via `view`; see parameters.view.enum for the full set):",
      "- Position state: `summary`, `open_positions`, `closed_positions` — current and historical position rows.",
      "- Holdings: `lots`, `balances`, `snapshots` — per-instrument lots, per-wallet balances, point-in-time snapshots.",
      "- P&L: `profits` (use `groupBy:namespace` to aggregate across protocols), `unrealized` (open-position MTM).",
      "- Activity log: `activity`, `executions`, `non_trading_history` — trade flow and operational events.",
      "- Orders: `orders` (open + recent terminal) — combine with `status` filter.",
      "- Cross-chain: `bridges`, `lp_history` — bridge intents and LP positions over time.",
      "- Unified feed: `transactions` — one chronological feed FUSING your successful trades/bridges/orders with THIS SESSION's FAILED trade-impacting attempts. Filter by `productType` (spot/perps/prediction/bridge/order), keyset-paginate with `cursor` (pass the prior response's `nextCursor` until `hasMore` is false), or pass `txHash` to look up a specific transaction across both halves. Failed rows carry no economics. Use this for \"what happened recently\" / \"did my last attempt fail\" / \"find this txHash\".",
      "Filters narrow the rows: `namespace` (protocol), `productType` (spot/perps/prediction), `instrumentKey`, `walletAddress`, `status`, `txHash`, `cursor`, `limit`.",
      "Freshness caveat: balances/snapshots reflect the last indexer sync, not on-chain head. For real-time per-token balance (e.g. confirming a swap landed), prefer `wallet_balances` (EVM) or `khalani_tokens_balances`. For instrument prices, use the relevant quote tools in the kyberswap/jupiter/polymarket namespaces.",
    ].join(" "),
    parameters: { type: "object", properties: {
      view: { type: "string", enum: ["open_positions", "activity", "executions", "balances", "snapshots", "summary", "lots", "profits", "closed_positions", "non_trading_history", "bridges", "lp_history", "orders", "unrealized", "transactions"], description: "What to inspect (see description for group breakdown)" },
      namespace: { type: "string", description: "Protocol filter (e.g. solana, khalani)" },
      productType: { type: "string", description: "Product filter (e.g. spot, perps, prediction)" },
      instrumentKey: { type: "string", description: "Instrument filter (lots, profits)" },
      walletAddress: { type: "string", description: "Wallet filter (profits)" },
      status: { type: "string", description: "Status filter (lots, orders)" },
      groupBy: { type: "string", enum: ["instrument", "namespace"], description: "Group by for profits (default: instrument)" },
      cursor: { type: "string", description: "Opaque pagination cursor (transactions) — pass the prior response's nextCursor to fetch the next page" },
      txHash: { type: "string", description: "Transaction hash anchor (transactions) — return rows matching this txHash across both halves" },
      limit: { type: "number", description: "Max rows (default 20)" },
    }, required: ["view"] },
  },
];
