/**
 * Engine runner shared utilities — tool definitions and default config.
 */

import { getOpenAITools } from "@vex-agent/tools/registry.js";
import type { ToolDefinition } from "@vex-agent/inference/types.js";
import type { TurnLoopConfig } from "../turn-loop.js";

/**
 * Convert OpenAITool[] to ToolDefinition[]. Type-level identity after
 * `ToolDefinition.function.parameters` was narrowed from
 * `Record<string, unknown>` to `JsonSchema` (PR3) — no cast needed.
 */
export function toToolDefinitions(openAITools: ReturnType<typeof getOpenAITools>): ToolDefinition[] {
  return openAITools.map(t => ({
    type: "function" as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

// ── Default loop config ─────────────────────────────────────────

export const DEFAULT_LOOP_CONFIG: TurnLoopConfig = {
  maxIterations: 50,
  timeoutMs: 600_000, // 10 minutes
  contextLimit: 128_000,
};
