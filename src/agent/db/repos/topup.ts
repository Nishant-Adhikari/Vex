/**
 * Top-up history + funding baseline repo.
 */

import { queryOne, query, execute } from "../client.js";
import type { FundingBaseline, TopupHistoryEntry, TopupEventType } from "../../types.js";

// ── Funding baseline ──────────────────────────────────────────────────

export async function getBaseline(): Promise<FundingBaseline> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT baseline_locked_og, baseline_total_og, last_topup_at, last_topup_amount_og, updated_at FROM funding_baseline WHERE id = 1",
  );
  if (!row) {
    return { baselineLockedOg: 0, baselineTotalOg: 0, lastTopupAt: null, lastTopupAmountOg: null, updatedAt: new Date().toISOString() };
  }
  return {
    baselineLockedOg: Number(row.baseline_locked_og),
    baselineTotalOg: Number(row.baseline_total_og),
    lastTopupAt: row.last_topup_at ? (row.last_topup_at as Date).toISOString() : null,
    lastTopupAmountOg: row.last_topup_amount_og != null ? Number(row.last_topup_amount_og) : null,
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

export async function updateBaseline(lockedOg: number, totalOg: number, topupAmount?: number): Promise<void> {
  await execute(
    `UPDATE funding_baseline SET
      baseline_locked_og = $1, baseline_total_og = $2,
      last_topup_at = NOW(), last_topup_amount_og = $3, updated_at = NOW()
     WHERE id = 1`,
    [lockedOg, totalOg, topupAmount ?? null],
  );
}

// ── Top-up history ────────────────────────────────────────────────────

export async function recordEvent(entry: {
  eventType: TopupEventType;
  action?: string;
  amountOg?: number;
  balanceBeforeOg?: number;
  balanceAfterOg?: number;
  source?: "auto" | "manual";
  error?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await execute(
    `INSERT INTO topup_history (event_type, action, amount_og, balance_before_og, balance_after_og, source, error, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.eventType,
      entry.action ?? null,
      entry.amountOg ?? null,
      entry.balanceBeforeOg ?? null,
      entry.balanceAfterOg ?? null,
      entry.source ?? "auto",
      entry.error ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ],
  );
}

export async function getRecentHistory(limit = 20): Promise<TopupHistoryEntry[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM topup_history ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return rows.map((row) => ({
    id: row.id as number,
    eventType: row.event_type as TopupEventType,
    action: row.action as string | null,
    amountOg: row.amount_og != null ? Number(row.amount_og) : null,
    balanceBeforeOg: row.balance_before_og != null ? Number(row.balance_before_og) : null,
    balanceAfterOg: row.balance_after_og != null ? Number(row.balance_after_og) : null,
    source: row.source as "auto" | "manual",
    error: row.error as string | null,
    metadata: (typeof row.metadata === "string" ? JSON.parse(row.metadata) : row.metadata) as Record<string, unknown>,
    createdAt: (row.created_at as Date).toISOString(),
  }));
}
