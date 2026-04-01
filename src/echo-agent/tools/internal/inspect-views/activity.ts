/**
 * Portfolio inspect — activity views: activity, bridges, lp_history, non_trading_history.
 * History feed from proj_activity.
 */

import type { ToolResult } from "../../types.js";
import { ok } from "../types.js";

export async function inspectActivity(namespace?: string, productType?: string, limit = 20): Promise<ToolResult> {
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
      inputValueUsd: a.inputValueUsd != null ? Number(a.inputValueUsd) : null,
      outputValueUsd: a.outputValueUsd != null ? Number(a.outputValueUsd) : null,
      valuationSource: a.valuationSource,
      captureStatus: a.captureStatus,
      createdAt: a.createdAt,
    })),
  });
}

export async function inspectBridges(namespace?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@echo-agent/db/client.js");
  const conditions: string[] = ["product_type = 'bridge'"];
  const params: unknown[] = [];
  let idx = 1;

  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  params.push(limit);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_activity WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  return ok({
    view: "bridges",
    count: rows.length,
    bridges: rows.map(r => ({
      namespace: r.namespace,
      chain: r.chain,
      wallet: r.wallet_address,
      inputToken: r.input_token,
      inputAmount: r.input_amount,
      outputToken: r.output_token,
      outputAmount: r.output_amount,
      captureStatus: r.capture_status,
      createdAt: r.created_at,
    })),
  });
}

export async function inspectLpHistory(namespace?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@echo-agent/db/client.js");
  const conditions: string[] = ["product_type = 'lp'"];
  const params: unknown[] = [];
  let idx = 1;

  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  params.push(limit);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_activity WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  return ok({
    view: "lp_history",
    count: rows.length,
    lpEvents: rows.map(r => ({
      namespace: r.namespace,
      chain: r.chain,
      instrumentKey: r.instrument_key,
      positionKey: r.position_key,
      captureStatus: r.capture_status,
      meta: r.meta,
      createdAt: r.created_at,
    })),
  });
}

export async function inspectNonTradingHistory(namespace?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@echo-agent/db/client.js");
  const conditions: string[] = ["product_type IN ('bridge', 'lend', 'wrap', 'allowance', 'reward', 'stake')"];
  const params: unknown[] = [];
  let idx = 1;

  if (namespace) { conditions.push(`namespace = $${idx++}`); params.push(namespace); }
  params.push(limit);

  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM proj_activity WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC LIMIT $${idx}`,
    params,
  );

  return ok({
    view: "non_trading_history",
    count: rows.length,
    activities: rows.map(r => ({
      namespace: r.namespace,
      type: r.activity_type,
      product: r.product_type,
      chain: r.chain,
      wallet: r.wallet_address,
      captureStatus: r.capture_status,
      createdAt: r.created_at,
    })),
  });
}
