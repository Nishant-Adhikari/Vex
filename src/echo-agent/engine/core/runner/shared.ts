/**
 * Engine runner shared utilities — tool definitions and default config.
 */

import { getOpenAITools } from "@echo-agent/tools/registry.js";
import type { ToolDefinition } from "@echo-agent/inference/types.js";
import type { TurnLoopConfig } from "../turn-loop.js";

/**
 * Convert OpenAITool[] to ToolDefinition[].
 * Structurally compatible at runtime — JsonSchema is a subset of Record<string, unknown>.
 */
export function toToolDefinitions(openAITools: ReturnType<typeof getOpenAITools>): ToolDefinition[] {
  return openAITools.map(t => ({
    type: "function" as const,
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as unknown as Record<string, unknown>,
    },
  }));
}

// ── Default loop config ─────────────────────────────────────────

export const DEFAULT_LOOP_CONFIG: TurnLoopConfig = {
  maxIterations: 50,
  timeoutMs: 600_000, // 10 minutes
  contextLimit: 128_000,
};
