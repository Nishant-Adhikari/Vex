/**
 * Messages repo — archive prefix selection (pure logic, no DB).
 */

import type { MessageWithId } from "./types.js";

export interface ArchivePrefixPlan {
  /** Messages destined for `messages_archive` — ordered oldest → newest. */
  prefix: MessageWithId[];
  /** Messages staying live — ordered oldest → newest. */
  tail: MessageWithId[];
  /** `prefix[last].id` when prefix is non-empty; `null` otherwise. */
  cutoffMessageId: number | null;
}

/**
 * Partition `messages` into an archivable prefix and a retained tail so that no
 * `assistant.tool_calls` ↔ `role:'tool'` pair is split across the boundary.
 *
 * Strategy: start the tail at the last `tailWindow` messages regardless of
 * role. If that index lands on a `role:'tool'` row, walk it backwards until we
 * pass the corresponding assistant — that way the assistant and ALL its tool
 * results end up in the tail together. Repeating this for adjacent tool rows
 * handles multi-tool-call batches. The assistant-save ordering in turn-loop
 * (`saveAssistantMessage` before `role:'tool'` inserts) guarantees the walk
 * terminates at the assistant without overshooting other turns' messages.
 *
 * When every live message is swallowed by the pair-integrity rule, `prefix`
 * is empty and `cutoffMessageId` is null — callers drop through to the giant-
 * tool fallback (or no-op).
 */
export function selectArchivePrefix(
  messages: readonly MessageWithId[],
  tailWindow: number,
): ArchivePrefixPlan {
  if (messages.length === 0) {
    return { prefix: [], tail: [], cutoffMessageId: null };
  }

  const window = Math.max(0, tailWindow);
  let startIdx = Math.max(0, messages.length - window);

  // Walk back while the tail starts on a tool row (would split an assistant/
  // tool_calls pair). Terminates at the parent assistant or index 0.
  while (startIdx > 0 && messages[startIdx]?.role === "tool") {
    startIdx--;
  }

  if (startIdx === 0) {
    return { prefix: [], tail: [...messages], cutoffMessageId: null };
  }

  const prefix = messages.slice(0, startIdx);
  const tail = messages.slice(startIdx);
  const last = prefix[prefix.length - 1];
  return {
    prefix,
    tail,
    cutoffMessageId: last ? last.id : null,
  };
}
