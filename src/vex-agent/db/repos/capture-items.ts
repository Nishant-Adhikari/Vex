/**
 * Capture items repo — per-position/per-trade items within a single protocol execution.
 *
 * Batch tool calls (predict.closeAll) produce N items from _tradeCaptureItems.
 * Single tool calls synthesize 1 item from _tradeCapture.
 */

import { query, queryOne } from "../client.js";
import { jsonb } from "../params.js";

export interface CaptureItemInput {
  tradeCapture: Record<string, unknown>;
  externalRefs: Record<string, unknown>;
}

export interface CaptureItemRecord {
  id: number;
  executionId: number;
  itemIndex: number;
  tradeCapture: Record<string, unknown>;
  externalRefs: Record<string, unknown>;
  createdAt: string;
}

export async function recordCaptureItems(
  executionId: number,
  items: CaptureItemInput[],
): Promise<number[]> {
  const ids: number[] = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const row = await queryOne<{ id: number }>(
      `INSERT INTO protocol_capture_items (execution_id, item_index, trade_capture, external_refs)
       VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id`,
      [executionId, i, jsonb(item.tradeCapture), jsonb(item.externalRefs)],
    );
    if (row) ids.push(row.id);
  }

  return ids;
}

export async function getByExecution(executionId: number): Promise<CaptureItemRecord[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM protocol_capture_items WHERE execution_id = $1 ORDER BY item_index ASC",
    [executionId],
  );
  return rows.map(mapRow);
}

function mapRow(r: Record<string, unknown>): CaptureItemRecord {
  return {
    id: r.id as number,
    executionId: r.execution_id as number,
    itemIndex: r.item_index as number,
    tradeCapture: (r.trade_capture as Record<string, unknown>) ?? {},
    externalRefs: (r.external_refs as Record<string, unknown>) ?? {},
    createdAt: r.created_at as string,
  };
}
