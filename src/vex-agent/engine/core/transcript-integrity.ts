/**
 * Transcript integrity — in-flight repair of orphaned tool_calls.
 *
 * Problem: when a previous turn was interrupted between dispatching a model's
 * tool_calls and persisting their tool_results (process kill, crash, partial
 * provider failure, etc.), the live message tape contains an `assistant`
 * row with `tool_calls` whose matching `tool` follow-ups never landed.
 * Replaying that conversation to a chat-completions API now triggers strict
 * validation errors (DeepSeek surfaces this as "Function call should not be
 * used with prefix"; Anthropic and OpenAI reject the same shape with their
 * own messages — every tool_use id MUST be followed by a tool_result).
 *
 * Solution: scan the provider message array chronologically and, for any
 * `assistant{tool_calls}` whose ids are not all matched by an immediately
 * adjacent run of `role:"tool"` rows, splice synthetic placeholder tool
 * results in *right after the assistant turn* (preserving the strict
 * `assistant → tool*` adjacency every provider expects).
 *
 * This module is pure and side-effect-free — no DB writes. The repair
 * exists only on the provider request body for the current call. The DB
 * tape stays as-is and is repaired the same way on the next turn. Durable
 * persistence would require inserting rows in the middle of an
 * autoincrement-id history, which is a much larger schema concern; the
 * in-flight approach is exact, idempotent, and provider-agnostic.
 */

import type { ProviderMessage } from "@vex-agent/inference/types.js";
import logger from "@utils/logger.js";

export const TOOL_RESULT_PLACEHOLDER_CONTENT =
  "[Engine: tool execution did not complete — placeholder]";

export interface RepairOutcome {
  /** Possibly-mutated message array. New array; original input is unchanged. */
  readonly messages: ProviderMessage[];
  /** Number of synthetic `role:"tool"` rows inserted. 0 means the input was clean. */
  readonly insertedPlaceholders: number;
  /** Tool-call ids that were skipped because the id field was empty. */
  readonly skippedBlankIds: number;
}

/**
 * Walk the message array once and repair any orphaned tool_calls in place.
 *
 * Returns a new array; the input is not mutated. Idempotent — running on an
 * already-repaired array is a no-op (no orphans to find).
 */
export function repairOrphanedToolCalls(
  messages: readonly ProviderMessage[],
): RepairOutcome {
  const result: ProviderMessage[] = [];
  let inserted = 0;
  let skippedBlank = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    result.push(msg);

    if (msg.role !== "assistant") continue;
    const calls = msg.toolCalls;
    if (!calls || calls.length === 0) continue;

    // Collect ids that need a downstream `tool` result. Empty/null ids
    // can't be matched and are not synthesizable — log and skip.
    const wantedIds: string[] = [];
    for (const c of calls) {
      if (typeof c.id !== "string" || c.id.length === 0) {
        skippedBlank += 1;
        continue;
      }
      wantedIds.push(c.id);
    }
    if (wantedIds.length === 0) continue;

    // Walk forward over the contiguous run of `role:"tool"` messages that
    // immediately follows. Stop at the first non-tool row — anything past
    // that point cannot count as adjacent and the validators will reject.
    const matched = new Set<string>();
    let j = i + 1;
    while (j < messages.length && messages[j].role === "tool") {
      const id = messages[j].toolCallId;
      if (typeof id === "string" && wantedIds.includes(id)) {
        matched.add(id);
      }
      result.push(messages[j]);
      j += 1;
    }
    i = j - 1; // resume the outer loop after the consumed tool run

    // Synthesize placeholders for any wanted id that didn't land. The
    // placeholders go right after the contiguous matched run so the strict
    // assistant → tool adjacency stays intact.
    for (const id of wantedIds) {
      if (matched.has(id)) continue;
      result.push({
        role: "tool",
        content: TOOL_RESULT_PLACEHOLDER_CONTENT,
        toolCallId: id,
      });
      inserted += 1;
    }
  }

  if (skippedBlank > 0) {
    logger.warn("engine.transcript.skipped_blank_tool_id", { skippedBlank });
  }

  return {
    messages: result,
    insertedPlaceholders: inserted,
    skippedBlankIds: skippedBlank,
  };
}
