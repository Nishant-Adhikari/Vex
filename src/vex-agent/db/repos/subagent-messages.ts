/**
 * Subagent messages repo — structured parent ↔ child channel.
 *
 * Schema: subagent_messages(id, subagent_id, direction, content,
 *   message_type, payload_json, reply_to_message_id, handled_at, created_at)
 *
 * message_type: relay (plain text), request_parent, reply, report_complete
 */

import { query, queryOne, execute } from "../client.js";

export type SubagentMessageType = "relay" | "request_parent" | "reply" | "report_complete";

export interface SubagentMessage {
  id: number;
  subagentId: string;
  direction: "to_parent" | "to_child";
  content: string;
  messageType: SubagentMessageType;
  payloadJson: Record<string, unknown> | null;
  replyToMessageId: number | null;
  handledAt: string | null;
  createdAt: string;
}

/**
 * Send a structured message in the parent ↔ child channel.
 * Backward-compatible: sendMessage() calls this with messageType "relay".
 */
export async function sendStructuredMessage(
  subagentId: string,
  direction: "to_parent" | "to_child",
  content: string,
  messageType: SubagentMessageType,
  payloadJson?: Record<string, unknown>,
  replyToMessageId?: number,
): Promise<number> {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO subagent_messages (subagent_id, direction, content, message_type, payload_json, reply_to_message_id)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [subagentId, direction, content, messageType,
     payloadJson ? JSON.stringify(payloadJson) : null,
     replyToMessageId ?? null],
  );
  return row?.id ?? 0;
}

/** Send a plain-text relay message. Backward-compatible wrapper. */
export async function sendMessage(
  subagentId: string,
  direction: "to_parent" | "to_child",
  content: string,
): Promise<number> {
  return sendStructuredMessage(subagentId, direction, content, "relay");
}

/** Get messages for a subagent, ordered by time. */
export async function getMessages(subagentId: string, limit = 100): Promise<SubagentMessage[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM subagent_messages WHERE subagent_id = $1 ORDER BY created_at ASC LIMIT $2",
    [subagentId, limit],
  );
  return rows.map(mapRow);
}

/** Get messages by direction (e.g. parent reads 'to_parent' messages). */
export async function getMessagesByDirection(
  subagentId: string,
  direction: "to_parent" | "to_child",
  limit = 50,
): Promise<SubagentMessage[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM subagent_messages WHERE subagent_id = $1 AND direction = $2 ORDER BY created_at ASC LIMIT $3",
    [subagentId, direction, limit],
  );
  return rows.map(mapRow);
}

/** Get unhandled messages, optionally filtered by type. */
export async function getUnhandled(
  subagentId: string,
  direction: "to_parent" | "to_child",
  messageType?: SubagentMessageType,
): Promise<SubagentMessage[]> {
  if (messageType) {
    const rows = await query<Record<string, unknown>>(
      `SELECT * FROM subagent_messages
       WHERE subagent_id = $1 AND direction = $2 AND message_type = $3 AND handled_at IS NULL
       ORDER BY created_at ASC`,
      [subagentId, direction, messageType],
    );
    return rows.map(mapRow);
  }
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM subagent_messages
     WHERE subagent_id = $1 AND direction = $2 AND handled_at IS NULL
     ORDER BY created_at ASC`,
    [subagentId, direction],
  );
  return rows.map(mapRow);
}

/** Get messages by type (e.g. report_complete). */
export async function getMessagesByType(
  subagentId: string,
  messageType: SubagentMessageType,
  limit = 10,
): Promise<SubagentMessage[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM subagent_messages
     WHERE subagent_id = $1 AND message_type = $2
     ORDER BY created_at DESC LIMIT $3`,
    [subagentId, messageType, limit],
  );
  return rows.map(mapRow);
}

/** Mark a message as handled. */
export async function markHandled(messageId: number): Promise<void> {
  await execute(
    "UPDATE subagent_messages SET handled_at = NOW() WHERE id = $1",
    [messageId],
  );
}

function mapRow(r: Record<string, unknown>): SubagentMessage {
  return {
    id: r.id as number,
    subagentId: r.subagent_id as string,
    direction: r.direction as "to_parent" | "to_child",
    content: r.content as string,
    messageType: (r.message_type as SubagentMessageType) ?? "relay",
    payloadJson: r.payload_json as Record<string, unknown> | null,
    replyToMessageId: r.reply_to_message_id as number | null,
    handledAt: r.handled_at ? (r.handled_at instanceof Date ? r.handled_at.toISOString() : r.handled_at as string) : null,
    createdAt: (r.created_at as Date).toISOString(),
  };
}
