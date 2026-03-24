import { query, queryOne, execute } from "../client.js";

interface SessionRow { id: string; started_at: string; ended_at: string | null; summary: string | null; compacted: boolean; message_count: number; token_count: number }

export async function createSession(id: string): Promise<void> {
  await execute("INSERT INTO sessions (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", [id]);
}

export async function getSession(id: string): Promise<SessionRow | null> {
  return queryOne<SessionRow>("SELECT * FROM sessions WHERE id = $1", [id]);
}

export async function listSessions(limit = 50): Promise<SessionRow[]> {
  return query<SessionRow>("SELECT * FROM sessions ORDER BY started_at DESC LIMIT $1", [limit]);
}

export async function updateSessionTokenCount(id: string, tokenCount: number): Promise<void> {
  await execute("UPDATE sessions SET token_count = $2 WHERE id = $1", [id, tokenCount]);
}

export async function compactSession(id: string, summary: string): Promise<void> {
  await execute("UPDATE sessions SET compacted = TRUE, summary = $2, ended_at = NOW() WHERE id = $1", [id, summary]);
}

/** Checkpoint compaction — update summary, reset counters. Session stays active (not compacted). */
export async function checkpointSession(id: string, summary: string): Promise<void> {
  await execute(
    "UPDATE sessions SET summary = $2, token_count = 0, message_count = 0 WHERE id = $1",
    [id, summary],
  );
}

/** Archive messages to messages_archive and delete from messages atomically. */
export async function archiveSessionMessages(sessionId: string): Promise<void> {
  await execute(
    `WITH moved AS (DELETE FROM messages WHERE session_id = $1 RETURNING *)
     INSERT INTO messages_archive SELECT * FROM moved`,
    [sessionId],
  );
}

/** Scope-filtered session listing (chat, telegram, loop, subagent, scheduler). */
export async function listSessionsByScope(scope: string, limit = 50): Promise<SessionRow[]> {
  return query<SessionRow>(
    "SELECT * FROM sessions WHERE scope = $1 ORDER BY started_at DESC LIMIT $2",
    [scope, limit],
  );
}

export async function setScope(id: string, scope: string, parentSessionId?: string | null): Promise<void> {
  await execute(
    "UPDATE sessions SET scope = $1, parent_session_id = COALESCE($2, parent_session_id) WHERE id = $3",
    [scope, parentSessionId ?? null, id],
  );
}
