/**
 * Messages repo — session message history.
 */

import { query, execute } from "../client.js";

export interface MessageRow {
  role: string;
  content: string;
  tool_call_id: string | null;
  tool_calls: unknown;
  created_at: string;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; command: string; args: Record<string, unknown> }>;
  timestamp: string;
}

export async function addMessage(sessionId: string, msg: Message): Promise<void> {
  await execute(
    `INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, created_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [sessionId, msg.role, msg.content, msg.toolCallId ?? null, msg.toolCalls ? JSON.stringify(msg.toolCalls) : null, msg.timestamp],
  );
  await execute("UPDATE sessions SET message_count = message_count + 1 WHERE id = $1", [sessionId]);
}

/** Get live messages (not archived) for a session. */
export async function getLiveMessages(sessionId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    "SELECT role, content, tool_call_id, tool_calls, created_at FROM messages WHERE session_id = $1 ORDER BY created_at ASC",
    [sessionId],
  );
  return rows.map(r => ({
    role: r.role as Message["role"],
    content: r.content,
    toolCallId: r.tool_call_id ?? undefined,
    toolCalls: r.tool_calls as Message["toolCalls"],
    timestamp: r.created_at,
  }));
}

/** Get all messages including archived (for history views). */
export async function getAllMessages(sessionId: string): Promise<Message[]> {
  const rows = await query<MessageRow>(
    `(SELECT role, content, tool_call_id, tool_calls, created_at FROM messages WHERE session_id = $1)
     UNION ALL
     (SELECT role, content, tool_call_id, tool_calls, created_at FROM messages_archive WHERE session_id = $1)
     ORDER BY created_at ASC`,
    [sessionId],
  );
  return rows.map(r => ({
    role: r.role as Message["role"],
    content: r.content,
    toolCallId: r.tool_call_id ?? undefined,
    toolCalls: r.tool_calls as Message["toolCalls"],
    timestamp: r.created_at,
  }));
}
