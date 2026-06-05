/**
 * Session-memories — read path. `getById` and `listActiveBySession` select
 * active rows via the shared `MEMORY_COLUMNS` list and `mapRow`.
 */

import { query, queryOne } from "../../client.js";
import {
  MEMORY_COLUMNS,
  mapRow,
  type SessionMemory,
  type SessionMemoryRow,
} from "./types.js";

export async function getById(id: number): Promise<SessionMemory | null> {
  if (!Number.isFinite(id) || id <= 0) return null;
  const row = await queryOne<SessionMemoryRow>(
    `SELECT ${MEMORY_COLUMNS} FROM session_memories WHERE id = $1`,
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function listActiveBySession(
  sessionId: string,
  limit = 50,
): Promise<SessionMemory[]> {
  const rows = await query<SessionMemoryRow>(
    `SELECT ${MEMORY_COLUMNS}
     FROM session_memories
     WHERE session_id = $1 AND status = 'active'
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, limit],
  );
  return rows.map(mapRow);
}
