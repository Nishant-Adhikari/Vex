/**
 * Autonomy inbox repo — typed event queue consumed by Echo Loop.
 *
 * Events are published by monitors (topup, subagent completion, external alerts)
 * and consumed by the loop at the start of each sense phase.
 *
 * Single-consumer design: only the echo loop calls consumePending().
 * CTE + FOR UPDATE SKIP LOCKED ensures safe atomic consume even if
 * called concurrently by accident.
 */

import { query, execute } from "../client.js";
import type { AutonomyEventType, AutonomyInboxEvent } from "../../types.js";

const CONSUME_BATCH_LIMIT = 100;
const PEEK_LIMIT = 50;

/** Publish an event to the autonomy inbox. */
export async function publish(
  eventType: AutonomyEventType,
  payload: Record<string, unknown> = {},
): Promise<void> {
  await execute(
    "INSERT INTO autonomy_inbox (event_type, payload) VALUES ($1, $2)",
    [eventType, JSON.stringify(payload)],
  );
}

/**
 * Atomically consume up to CONSUME_BATCH_LIMIT pending events (oldest first).
 * Uses CTE with FOR UPDATE SKIP LOCKED for concurrency safety.
 */
export async function consumePending(): Promise<AutonomyInboxEvent[]> {
  const rows = await query<Record<string, unknown>>(
    `WITH batch AS (
       SELECT id FROM autonomy_inbox
       WHERE consumed = FALSE
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE autonomy_inbox SET consumed = TRUE
     FROM batch WHERE autonomy_inbox.id = batch.id
     RETURNING autonomy_inbox.id, autonomy_inbox.event_type, autonomy_inbox.payload, autonomy_inbox.consumed, autonomy_inbox.created_at`,
    [CONSUME_BATCH_LIMIT],
  );
  // Sort in application code — RETURNING does not guarantee order
  return rows.map(mapRow).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Peek at unconsumed events without consuming them. */
export async function peekPending(): Promise<AutonomyInboxEvent[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT id, event_type, payload, consumed, created_at FROM autonomy_inbox WHERE consumed = FALSE ORDER BY created_at ASC LIMIT $1",
    [PEEK_LIMIT],
  );
  return rows.map(mapRow);
}

/** Mark a specific event as consumed. */
export async function markConsumed(id: number): Promise<void> {
  await execute("UPDATE autonomy_inbox SET consumed = TRUE WHERE id = $1", [id]);
}

/** Purge consumed events older than N hours. */
export async function purgeOld(hours = 24): Promise<void> {
  await execute(
    "DELETE FROM autonomy_inbox WHERE consumed = TRUE AND created_at < NOW() - ($1 || ' hours')::INTERVAL",
    [hours],
  );
}

function mapRow(row: Record<string, unknown>): AutonomyInboxEvent {
  return {
    id: row.id as number,
    eventType: row.event_type as AutonomyEventType,
    payload: (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>,
    consumed: row.consumed as boolean,
    createdAt: (row.created_at as Date).toISOString(),
  };
}
