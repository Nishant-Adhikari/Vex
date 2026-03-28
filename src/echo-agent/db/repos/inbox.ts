/**
 * Inbox repo — typed event queue consumed by runtime loop.
 *
 * Single-consumer design: CTE + FOR UPDATE SKIP LOCKED for safe atomic consume.
 */

import { query, execute } from "../client.js";

export interface InboxEvent {
  id: number;
  eventType: string;
  payload: Record<string, unknown>;
  consumed: boolean;
  createdAt: string;
}

const CONSUME_BATCH_LIMIT = 100;
const PEEK_LIMIT = 50;

function mapRow(row: Record<string, unknown>): InboxEvent {
  return {
    id: row.id as number,
    eventType: row.event_type as string,
    payload: (typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload) as Record<string, unknown>,
    consumed: row.consumed as boolean,
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/** Publish an event to the inbox. */
export async function publish(eventType: string, payload: Record<string, unknown> = {}): Promise<void> {
  await execute(
    "INSERT INTO inbox_events (event_type, payload) VALUES ($1, $2)",
    [eventType, JSON.stringify(payload)],
  );
}

/** Atomically consume up to CONSUME_BATCH_LIMIT pending events (oldest first). */
export async function consumePending(): Promise<InboxEvent[]> {
  const rows = await query<Record<string, unknown>>(
    `WITH batch AS (
       SELECT id FROM inbox_events
       WHERE consumed = FALSE
       ORDER BY created_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE inbox_events SET consumed = TRUE
     FROM batch WHERE inbox_events.id = batch.id
     RETURNING inbox_events.*`,
    [CONSUME_BATCH_LIMIT],
  );
  return rows.map(mapRow).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Peek at unconsumed events without consuming. */
export async function peekPending(): Promise<InboxEvent[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM inbox_events WHERE consumed = FALSE ORDER BY created_at ASC LIMIT $1",
    [PEEK_LIMIT],
  );
  return rows.map(mapRow);
}

/** Purge consumed events older than N hours. */
export async function purgeOld(hours = 24): Promise<number> {
  return execute(
    "DELETE FROM inbox_events WHERE consumed = TRUE AND created_at < NOW() - ($1 || ' hours')::INTERVAL",
    [hours],
  );
}
