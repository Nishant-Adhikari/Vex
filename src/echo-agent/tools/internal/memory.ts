/**
 * Memory internal tool handler — CRUD on persistent memory entries.
 */

import * as memoryRepo from "@echo-agent/db/repos/memory.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num, ok, fail } from "./types.js";

export async function handleMemoryManage(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const action = str(params, "action");

  if (action === "list") {
    const entries = await memoryRepo.listEntriesWithIds();
    return ok({ count: entries.length, entries });
  }

  if (action === "append") {
    const text = str(params, "append") || str(params, "content");
    if (!text) return fail("Missing text to append");
    const inserted = await memoryRepo.appendMemory(text, undefined, "echo-agent");
    return ok({ appended: inserted, message: inserted ? "Memory entry appended" : "Duplicate — entry already exists" });
  }

  if (action === "replace") {
    const id = num(params, "id");
    const content = str(params, "content");
    if (id === undefined || !content) return fail("Missing id or content for replace");
    const replaced = await memoryRepo.replaceEntry(id, content);
    if (!replaced) return fail(`Memory entry #${id} not found`);
    return ok({ replaced: true, id, message: `Memory entry #${id} replaced` });
  }

  if (action === "delete") {
    const id = num(params, "id");
    if (id === undefined) return fail("Missing id for delete");
    const deleted = await memoryRepo.deleteEntry(id);
    if (!deleted) return fail(`Memory entry #${id} not found`);
    return ok({ deleted: true, id, message: `Memory entry #${id} deleted` });
  }

  return fail(`Unknown memory action: "${action}". Use: list, append, replace, delete`);
}
