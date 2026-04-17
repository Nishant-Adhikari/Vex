/**
 * Sessions repo — session lifecycle, compaction, scope.
 *
 * Compaction model (post-session-episodes rollout):
 *   - `setRollingSummary` updates only the summary text.
 *   - `archivePrefix` moves a bounded prefix of messages into `messages_archive`
 *     (partial compact) and sets the new live `message_count`. `token_count`
 *     is NOT reset here — it's overwritten by the next turn's prompt size in
 *     `turn.ts::updateTokenCount`.
 *   - `forkToolMessageToArchive` is the giant-tool fallback: it COPIES a single
 *     live row into `messages_archive` (same id, full payload) and overwrites
 *     the live row's `content` with a short placeholder. Used when a bloated
 *     tool output in the tail is the sole source of context pressure.
 *
 * The legacy full-archive helpers (`checkpointSession` / `archiveMessages`) were
 * removed — they reset `message_count = 0` even under partial archive, which
 * broke the session invariant once a tail was left live.
 */

import { getPool, query, queryOne, execute } from "../client.js";

interface SessionRow {
  id: string;
  scope: string;
  started_at: string;
  ended_at: string | null;
  summary: string | null;
  compacted: boolean;
  message_count: number;
  token_count: number;
  memory_scope_key: string | null;
}

export interface Session {
  id: string;
  scope: string;
  startedAt: string;
  endedAt: string | null;
  summary: string | null;
  compacted: boolean;
  messageCount: number;
  tokenCount: number;
  memoryScopeKey: string | null;
}

function mapRow(r: SessionRow): Session {
  return {
    id: r.id,
    scope: r.scope,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    summary: r.summary,
    compacted: r.compacted,
    messageCount: r.message_count,
    tokenCount: r.token_count,
    memoryScopeKey: r.memory_scope_key,
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

/**
 * Set the semantic memory scope key used by `session_episodes` recall.
 *
 * Separate from `scope` (which is coarse: `chat` / `mcp` / `subagent`). The
 * scope key is the identity that episodic recall groups on — typically the
 * session id itself, but subagents inherit the parent's scope so their
 * checkpoints contribute to the parent's memory.
 */
export async function setMemoryScopeKey(id: string, memoryScopeKey: string): Promise<void> {
  await execute(
    "UPDATE sessions SET memory_scope_key = $2 WHERE id = $1",
    [id, memoryScopeKey],
  );
}

/** SET token count — latest prompt size for checkpoint pressure evaluation. Not cumulative. */
export async function updateTokenCount(id: string, tokenCount: number): Promise<void> {
  await execute("UPDATE sessions SET token_count = $2 WHERE id = $1", [id, tokenCount]);
}

/**
 * Persist the rolling session summary. Does NOT touch `token_count` or
 * `message_count`; those are partial-archive concerns and live on
 * `archivePrefix`.
 */
export async function setRollingSummary(id: string, summary: string): Promise<void> {
  await execute("UPDATE sessions SET summary = $2 WHERE id = $1", [id, summary]);
}

/**
 * Partial archive — move messages with `id <= cutoffMessageId` into
 * `messages_archive` and set the live `message_count` to `remainingCount`
 * (i.e. the tail length that stays). Atomic via explicit transaction so a
 * crash mid-way cannot leave messages deleted without their archive copy.
 *
 * Column parity between `messages` and `messages_archive` is required by
 * migration 002; this helper relies on that invariant.
 */
export async function archivePrefix(
  sessionId: string,
  cutoffMessageId: number,
  remainingCount: number,
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `WITH moved AS (
         DELETE FROM messages
         WHERE session_id = $1 AND id <= $2
         RETURNING *
       )
       INSERT INTO messages_archive SELECT * FROM moved`,
      [sessionId, cutoffMessageId],
    );
    await client.query(
      "UPDATE sessions SET message_count = $2 WHERE id = $1",
      [sessionId, remainingCount],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Giant-tool fallback — COPY (not MOVE) a single live message into the archive
 * and replace the live row's `content` with a short placeholder.
 *
 * The live row keeps its `id` and `tool_call_id` so `assistant.tool_calls` ↔
 * `role:'tool'` pairing survives. The archive row carries the full payload
 * under the same `id`, so a future chunked-read tool can resolve the pointer.
 *
 * Retry safety: on repeat invocation the archive gets a duplicate row (archive
 * has no PK beyond the LIKE-inherited indexes). That's accepted — archive is
 * append-only by design and readers dedupe by id when needed.
 */
export async function forkToolMessageToArchive(
  messageId: number,
  placeholderContent: string,
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "INSERT INTO messages_archive SELECT * FROM messages WHERE id = $1",
      [messageId],
    );
    await client.query(
      "UPDATE messages SET content = $2 WHERE id = $1",
      [messageId, placeholderContent],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    client.release();
  }
}

export async function listSessions(scope?: string, limit = 50): Promise<Session[]> {
  const rows = scope
    ? await query<SessionRow>("SELECT * FROM sessions WHERE scope = $1 ORDER BY started_at DESC LIMIT $2", [scope, limit])
    : await query<SessionRow>("SELECT * FROM sessions ORDER BY started_at DESC LIMIT $1", [limit]);
  return rows.map(mapRow);
}
