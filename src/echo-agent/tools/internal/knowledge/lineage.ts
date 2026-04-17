/**
 * knowledge_lineage handler — full version chain (root → head) from any id.
 *
 * Read-only browse. Unlike `knowledge_get`, this does NOT inject anything
 * into `loadedDocuments` — lineage is metadata navigation, not content load.
 * Callers that want full text fetch the resolved `headId` (or any id) via
 * `knowledge_get`.
 */

import * as knowledgeRepo from "@echo-agent/db/repos/knowledge.js";
import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { num, ok, fail } from "../types.js";

export async function handleKnowledgeLineage(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const id = num(params, "id");
  if (id === undefined) return fail("Missing required parameter: id");

  const result = await knowledgeRepo.getLineageChain(id);
  if (!result) return fail(`knowledge entry not found: ${id}`);

  return ok({
    requestedId: result.requestedId,
    headId: result.headId,
    headStatus: result.headStatus,
    chainLength: result.chain.length,
    chain: result.chain,
  });
}
