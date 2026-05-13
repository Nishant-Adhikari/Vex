/**
 * Prompt stack composition — builds the full system prompt for the engine.
 *
 * Two layers:
 * - CONSTANT (always present): base, tool-usage, protocols
 * - VARIABLE (per mode/permission/context): permission, agent/mission-setup/mission-run/subagent
 *
 * Rule: mode and permission change policy execution, never the scope of
 * protocol knowledge.
 */

import type { EngineContext } from "../types.js";
import { buildBasePrompt } from "./base.js";
import { buildToolUsagePrompt } from "./tool-usage.js";
import { buildProtocolsPrompt } from "./protocols.js";
import { buildPermissionPrompt } from "./mode.js";
import { buildAgentPrompt } from "./agent.js";
import { buildMissionSetupPrompt, type MissionSetupContext } from "./mission-setup.js";
import { buildMissionRunPrompt, type MissionRunContext } from "./mission-run.js";
import { buildSubagentPrompt, type SubagentContext } from "./subagent.js";
import {
  buildRuntimeClockPrompt,
  buildRuntimeClockSnapshot,
  type RuntimeClockSnapshot,
} from "../runtime-clock.js";

export interface PromptStackOptions {
  missionSetupContext?: MissionSetupContext;
  missionRunContext?: MissionRunContext;
  subagentContext?: SubagentContext;
  /** Optional test/host override; production builds this from EngineContext. */
  runtimeClock?: RuntimeClockSnapshot;
  /**
   * Pre-formatted Active Knowledge block (hot context entries + Known kinds).
   * Built by `formatActiveKnowledgeBlock` after pre-fetching repo state in
   * `executeTurn`. Empty string omits the section entirely.
   * Kept as a sync option (not a fetch hook) so this builder remains pure.
   */
  activeKnowledgeBlock?: string;
}

/**
 * Build the full prompt stack for the engine.
 *
 * Returns an array of prompt sections — caller joins them.
 */
export function buildPromptStack(
  context: EngineContext,
  options: PromptStackOptions = {},
): string[] {
  const layers: string[] = [];

  // ── CONSTANT — always present ─────────────────────────────
  layers.push(buildBasePrompt(context));
  layers.push(buildRuntimeClockPrompt(options.runtimeClock ?? buildRuntimeClockSnapshot({
    sessionStartedAt: context.sessionStartedAt ?? null,
    missionRunStartedAt: context.missionRunStartedAt ?? null,
    missionDeadline: context.missionDeadline ?? null,
  })));
  if (options.activeKnowledgeBlock && options.activeKnowledgeBlock.length > 0) {
    layers.push(options.activeKnowledgeBlock);
  }
  layers.push(buildToolUsagePrompt());
  layers.push(buildProtocolsPrompt());

  // ── VARIABLE — per mode + permission ──────────────────────
  layers.push(buildPermissionPrompt({ mode: context.sessionKind, permission: context.sessionPermission }));

  // ── CONTEXTUAL — per sessionKind ──────────────────────────
  if (context.sessionKind === "agent" && !context.missionRunId) {
    layers.push(buildAgentPrompt());
  }

  if (context.sessionKind === "mission" && !context.missionRunId) {
    layers.push(buildMissionSetupPrompt(context, options.missionSetupContext));
  }

  if (context.missionRunId) {
    layers.push(buildMissionRunPrompt(context, options.missionRunContext));
  }

  // ── SUBAGENT — override ───────────────────────────────────
  if (context.isSubagent) {
    layers.push(buildSubagentPrompt(context, options.subagentContext));
  }

  return layers;
}

// Re-exports for direct use
export { buildBasePrompt } from "./base.js";
export { buildToolUsagePrompt } from "./tool-usage.js";
export { buildProtocolsPrompt, resetProtocolsPromptCache } from "./protocols.js";
export { buildPermissionPrompt } from "./mode.js";
export { buildAgentPrompt } from "./agent.js";
export { buildMissionSetupPrompt, type MissionSetupContext } from "./mission-setup.js";
export { buildMissionRunPrompt, type MissionRunContext } from "./mission-run.js";
export { buildSubagentPrompt, type SubagentContext } from "./subagent.js";
