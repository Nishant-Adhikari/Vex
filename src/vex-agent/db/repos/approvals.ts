/**
 * Approvals repo — tool execution approval queue.
 */

import { query, queryOne, execute } from "../client.js";
import { jsonb, nullableJsonb } from "../params.js";

export interface ApprovalItem {
  id: string;
  toolCall: Record<string, unknown>;
  reasoning: string;
  status: "pending" | "approved" | "rejected";
  sessionId: string | null;
  toolCallId: string | null;
  chatMode: string;
  createdAt: string;
  resolvedAt: string | null;
}

function mapRow(r: Record<string, unknown>): ApprovalItem {
  return {
    id: r.id as string,
    toolCall: r.tool_call as Record<string, unknown>,
    reasoning: r.reasoning as string,
    status: r.status as ApprovalItem["status"],
    sessionId: r.session_id as string | null,
    toolCallId: r.tool_call_id as string | null,
    chatMode: (r.chat_mode as string) ?? "restricted",
    createdAt: r.created_at as string,
    resolvedAt: r.resolved_at as string | null,
  };
}

export async function enqueue(
  id: string,
  toolCall: Record<string, unknown>,
  reasoning: string,
  sessionId: string,
  toolCallId?: string,
  chatMode?: string,
): Promise<void> {
  const pendingContext = nullableJsonb(toolCallId ? { toolCallId } : null);
  await execute(
    `INSERT INTO approval_queue (id, tool_call, reasoning, status, session_id, tool_call_id, chat_mode, pending_context)
     VALUES ($1, $2::jsonb, $3, 'pending', $4, $5, $6, $7::jsonb)`,
    [id, jsonb(toolCall), reasoning, sessionId, toolCallId ?? null, chatMode ?? "restricted", pendingContext],
  );
}

/** Atomically approve — returns null if already resolved. */
export async function approve(id: string): Promise<(ApprovalItem & { pendingContext: Record<string, unknown> | null }) | null> {
  const row = await queryOne<Record<string, unknown>>(
    "UPDATE approval_queue SET status = 'approved', resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *",
    [id],
  );
  if (!row) return null;
  const ctx = row.pending_context as Record<string, unknown> | null;
  return { ...mapRow(row), pendingContext: ctx };
}

export async function reject(id: string): Promise<ApprovalItem | null> {
  const row = await queryOne<Record<string, unknown>>(
    "UPDATE approval_queue SET status = 'rejected', resolved_at = NOW() WHERE id = $1 AND status = 'pending' RETURNING *",
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function getPending(): Promise<ApprovalItem[]> {
  const rows = await query<Record<string, unknown>>(
    "SELECT * FROM approval_queue WHERE status = 'pending' ORDER BY created_at",
  );
  return rows.map(mapRow);
}

export async function getPendingCount(): Promise<number> {
  const r = await queryOne<{ c: string }>("SELECT COUNT(*) AS c FROM approval_queue WHERE status = 'pending'");
  return parseInt(r?.c ?? "0", 10);
}
