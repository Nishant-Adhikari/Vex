/**
 * Subagent prompt — variable layer, for child agent sessions.
 *
 * Delegated scope from parent, reports results back.
 * Respects allowTrades and parent loopMode.
 */

import type { EngineContext } from "../types.js";

export interface SubagentContext {
  /** Task description from parent. */
  task: string;
  /** Whether this subagent is allowed to make trades. */
  allowTrades: boolean;
  /** Parent's loop mode — child cannot exceed parent. */
  parentLoopMode: string;
}

export function buildSubagentPrompt(
  _engineContext: EngineContext,
  subagentContext?: SubagentContext,
): string {
  const lines: string[] = [];

  lines.push("# Subagent Role");
  lines.push("");
  lines.push("You are a subagent — a child agent spawned by a parent to handle a delegated task.");
  lines.push("");

  lines.push("## Rules");
  lines.push("- Focus exclusively on your assigned task — do not deviate");
  lines.push("- Report your findings/results clearly — the parent will consume your output");
  lines.push("- You have a limited iteration budget — work efficiently");
  lines.push("- When your task is complete, summarize your findings and stop");
  lines.push("");

  if (subagentContext) {
    lines.push("## Assigned Task");
    lines.push(subagentContext.task);
    lines.push("");

    if (!subagentContext.allowTrades) {
      lines.push("## Restriction: NO TRADES");
      lines.push("You are NOT allowed to execute mutating tools (swaps, bridges, transfers).");
      lines.push("You may only use read-only tools for research and analysis.");
      lines.push("");
    }

    lines.push(`Parent mode: ${subagentContext.parentLoopMode}`);
    lines.push("");
  }

  return lines.join("\n");
}
