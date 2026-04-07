/**
 * Sessions repo — session lifecycle, compaction, scope.
 */

import { query, queryOne, execute } from "../client.js";

interface SessionRow { id: string; scope: string; started_at: string; ended_at: string | null; summary: string | null; compacted: boolean; message_count: number; token_count: number }

export interface Session {
  id: string;
  scope: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  compacted: boolean;
  messageCount: number;
  tokenCount: number;
}

function mapRow(r: SessionRow): Session {
  return {
    id: r.id, scope: r.scope, startedAt: r.started_at, endedAt: r.ended_at,
    summary: r.summary, compacted: r.compacted, messageCount: r.message_count, tokenCount: r.token_count,
  };
}

export async function createSession(id: string): Promise<void> {
  await execute("INSERT INTO sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [id]);
}

/**
 * Mark a session as ended. Idempotent — safe to call multiple times on a
 * session that has already been ended (only the first call writes a value).
 *
 * Used by the production MCP server (`src/mcp/sessions.ts`) on transport
 * disconnect, so the `sessions.ended_at` column reflects MCP connection
 * lifecycle. Echo Agent's chat / mission flows do not call this — their
 * sessions stay open until compaction.
 */
export async function endSession(id: string): Promise<void> {
  await execute(
    "UPDATE sessions SET ended_at = NOW() WHERE id = $1 AND ended_at IS NULL",
    [id],
  );
}

export async function getSession(id: string): Promise<Session | null> {
  const row = await queryOne<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
  return row ? mapRow(row) : null;
}

export async function setScope(id: string, scope: string): Promise<void> {
  await execute("UPDATE sessions SET scope = $1 WHERE id = $2", [scope, id]);
}

/** SET token count — latest prompt size for checkpoint pressure evaluation. Not cumulative. */
export async function updateTokenCount(id: string, tokenCount: number): Promise<void> {
  await execute("UPDATE sessions SET token_count = $2 WHERE id = $1", [id, tokenCount]);
}

export async function checkpointSession(id: string, summary: string): Promise<void> {
  await execute(
    "UPDATE sessions SET summary = $2, token_count = 0, message_count = 0 WHERE id = $1",
    [id, summary],
  );
}

export async function archiveMessages(sessionId: string): Promise<void> {
  await execute(
    `WITH moved AS (DELETE FROM messages WHERE session_id = $1 RETURNING *)
     INSERT INTO messages_archive SELECT * FROM moved`,
    [sessionId],
  );
}

export async function listSessions(scope?: string, limit = 50): Promise<Session[]> {
  const rows = scope
    ? await query<SessionRow>("SELECT * FROM sessions WHERE scope = $1 ORDER BY started_at DESC LIMIT $2", [scope, limit])
    : await query<SessionRow>("SELECT * FROM sessions ORDER BY started_at DESC LIMIT $1", [limit]);
  return rows.map(mapRow);
}
