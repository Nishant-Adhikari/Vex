/**
 * knowledge_history handler — browse historical entries by explicit filters.
 *
 * Default behaviour: non-active only (superseded ∪ invalidated ∪ archived).
 * `status='active'` is the explicit opt-in for browsing active rows — the
 * tool description states this so the LLM does not lean on it as a substitute
 * for `knowledge_recall` (semantic active recall remains the canonical path).
 *
 * Read-only — does NOT touch `loadedDocuments`.
 */

import * as knowledgeRepo from "@echo-agent/db/repos/knowledge.js";
import { isKnowledgeStatus } from "@echo-agent/knowledge/policy.js";
import type { HistoryStatus } from "@echo-agent/db/repos/knowledge.js";
import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { num, str, ok, fail } from "../types.js";

export async function handleKnowledgeHistory(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const rawStatus = str(params, "status");
  let status: HistoryStatus | undefined;
  if (rawStatus.length > 0) {
    if (!isKnowledgeStatus(rawStatus)) {
      return fail(
        `Invalid status: ${rawStatus}. Allowed: active, superseded, invalidated, archived.`,
      );
    }
    status = rawStatus;
  }

  const rawKind = str(params, "kind");
  const kind = rawKind.length > 0 ? rawKind : undefined;

  const limit = num(params, "limit") ?? 0; // 0 → repo clamps to default

  const entries = await knowledgeRepo.listHistory({ status, kind, limit });

  return ok({
    entries,
    count: entries.length,
    filters: {
      status: status ?? null,
      kind: kind ?? null,
    },
  });
}
