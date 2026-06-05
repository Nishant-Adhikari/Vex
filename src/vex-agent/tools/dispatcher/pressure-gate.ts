/**
 * Pressure-band hard-deny gate for the dispatcher.
 *
 * Runtime safety net for the context-pressure tool projection: the soft filter
 * (LLM-visible tool catalog) is the first layer; this gate rejects mutating
 * tools the model emits anyway at barrier/critical bands, and gates
 * `compact_only` tools to those bands.
 */

import type { ToolResult } from "../types.js";
import { getPressureSafety } from "../registry.js";
import type { ContextUsageBand } from "@vex-agent/engine/core/context-band.js";

/**
 * Pressure-band hard-deny check. Returns a synthetic error result when the
 * tool should be blocked at the current band; returns null when dispatch can
 * proceed. Bands `barrier` and `critical` block tools with `pressureSafety
 * === "mutating"`. `compact_only` tools dispatch only at those bands.
 */
export function checkPressureDeny(
  toolName: string,
  band: ContextUsageBand,
): ToolResult | null {
  const safety = getPressureSafety(toolName);
  if (safety === undefined) return null; // unknown tool — let routing handle it

  const atBarrier = band === "barrier" || band === "critical";

  if (atBarrier && safety === "mutating") {
    return {
      success: false,
      output:
        `Tool ${toolName} is blocked at context pressure ${band}. ` +
        `Call compact_now first to compact the conversation; the next turn after compaction restores the full tool set.`,
    };
  }

  if (!atBarrier && safety === "compact_only") {
    return {
      success: false,
      output:
        `Tool ${toolName} is only available at context pressure barrier (≥ 88% of context limit). ` +
        `Current band is ${band}; continue with normal work.`,
    };
  }

  return null;
}
