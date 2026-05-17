/**
 * Resume packet — deterministic snapshot injected into the system prompt
 * for the first `POST_COMPACT_BRIDGE_CYCLES` (default 2) turns immediately
 * after a `compact_committed` engine signal.
 *
 * Sourced entirely from DB (no LLM calls, no embeddings). Includes:
 *   - The fresh rolling summary from `sessions.summary` (agent's own
 *     conversation_summary input to compact_now).
 *   - The `preserve_md` field from the most recent `compact_jobs` row, lightly
 *     sanitized (preserve is data not instructions).
 *   - Up to N unresolved outstanding items aggregated across active chunks.
 *   - Last 3 assistant decisions and last 3 tool outcomes (best-effort from
 *     the post-archive `messages` table, which is now the post-compact tail
 *     so it's a small read).
 *
 * Codex required: "include sanitized preserve_md in resume packets."
 */

import { query, queryOne } from "@vex-agent/db/client.js";
import { getBySessionAndGeneration } from "@vex-agent/db/repos/compact-jobs/index.js";

const MAX_UNRESOLVED_LINES = 10;
const MAX_DECISIONS = 3;
const MAX_TOOL_OUTCOMES = 3;

export async function buildResumePacket(
  sessionId: string,
  generation: number,
): Promise<string> {
  const session = await queryOne<{ summary: string | null; checkpoint_generation: number }>(
    "SELECT summary, checkpoint_generation FROM sessions WHERE id = $1",
    [sessionId],
  );
  if (!session) return "";

  const compactJob = await getBySessionAndGeneration(sessionId, generation);

  // Aggregate unresolved outstanding items across active chunks.
  const outstandingRows = await query<{ memory_id: number; theme: string; item_id: string; text: string }>(
    `SELECT m.id AS memory_id, m.theme, item->>'id' AS item_id, item->>'text' AS text
     FROM session_memories m,
          jsonb_array_elements(m.outstanding_items) item
     WHERE m.session_id = $1
       AND m.status = 'active'
       AND item->>'resolved_at' IS NULL
     ORDER BY m.created_at DESC, m.id DESC
     LIMIT $2`,
    [sessionId, MAX_UNRESOLVED_LINES],
  );

  // Last N assistant messages with substantive content (decisions).
  const decisionRows = await query<{ content: string; created_at: string }>(
    `SELECT content, created_at
     FROM messages
     WHERE session_id = $1
       AND role = 'assistant'
       AND content IS NOT NULL
       AND length(content) > 40
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, MAX_DECISIONS],
  );

  // Last N tool result messages.
  const toolRows = await query<{ tool_call_id: string | null; content: string; created_at: string }>(
    `SELECT tool_call_id, content, created_at
     FROM messages
     WHERE session_id = $1
       AND role = 'tool'
     ORDER BY created_at DESC, id DESC
     LIMIT $2`,
    [sessionId, MAX_TOOL_OUTCOMES],
  );

  const lines: string[] = [];
  lines.push(`[Resume packet — generation ${session.checkpoint_generation}, just compacted]`);
  lines.push("");
  lines.push("## Rolling summary");
  lines.push(session.summary?.trim() || "(empty)");
  lines.push("");
  if (compactJob?.preserveMd && compactJob.preserveMd.trim().length > 0) {
    lines.push("## Preserve");
    // preserve_md is treated as data, not instructions. Wrap in fenced block
    // so any embedded markdown / pseudo-tags do not influence the prompt.
    lines.push("```");
    lines.push(compactJob.preserveMd.trim());
    lines.push("```");
    lines.push("");
  }
  if (outstandingRows.length > 0) {
    lines.push(`## Outstanding follow-ups (${outstandingRows.length})`);
    for (const r of outstandingRows) {
      lines.push(`- [${r.theme}] (memory_id=${r.memory_id}, item_id=${r.item_id}) ${r.text}`);
    }
    lines.push("");
  }
  if (decisionRows.length > 0) {
    lines.push(`## Recent decisions (last ${decisionRows.length})`);
    for (const r of decisionRows) {
      const compact = r.content.replace(/\s+/g, " ").trim().slice(0, 280);
      lines.push(`- (${r.created_at}) ${compact}`);
    }
    lines.push("");
  }
  if (toolRows.length > 0) {
    lines.push(`## Recent tool outcomes (last ${toolRows.length})`);
    for (const r of toolRows) {
      const compact = r.content.replace(/\s+/g, " ").trim().slice(0, 240);
      lines.push(`- (${r.created_at}) ${compact}`);
    }
  }
  return lines.join("\n");
}
