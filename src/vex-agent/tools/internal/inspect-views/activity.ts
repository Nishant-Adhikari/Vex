/**
 * Portfolio inspect — activity views: activity, bridges, lp_history, non_trading_history.
 * History feed from proj_activity.
 */

import type { ToolResult } from "../../types.js";
import { ok } from "../types.js";

export async function inspectActivity(addresses: string[], namespace?: string, productType?: string, limit = 20): Promise<ToolResult> {
  const { getActivities } = await import("@vex-agent/db/repos/activity.js");
  const activities = await getActivities({ addresses, namespace, productType, limit });

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

export async function inspectBridges(addresses: string[], namespace?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@vex-agent/db/client.js");
  const conditions: string[] = ["product_type = 'bridge'", "wallet_address = ANY($1::text[])"];
  const params: unknown[] = [addresses];
  let idx = 2;

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

export async function inspectLpHistory(addresses: string[], namespace?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@vex-agent/db/client.js");
  const conditions: string[] = ["product_type = 'lp'", "wallet_address = ANY($1::text[])"];
  const params: unknown[] = [addresses];
  let idx = 2;

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

export async function inspectNonTradingHistory(addresses: string[], namespace?: string, limit = 20): Promise<ToolResult> {
  const { query } = await import("@vex-agent/db/client.js");
  const conditions: string[] = ["product_type IN ('bridge', 'lend', 'wrap', 'allowance', 'reward', 'stake')", "wallet_address = ANY($1::text[])"];
  const params: unknown[] = [addresses];
  let idx = 2;

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
