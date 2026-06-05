/**
 * Turn-loop state types — the public config/result shapes for `runTurnLoop`.
 * Extracted from `turn-loop.ts` for scaling.
 *
 * Pure declarations only: no runtime behavior, no side effects. The
 * orchestrator (`turn-loop.ts`) and its callers consume these via the
 * façade re-export, so the public surface is unchanged.
 */

import type { StopReason } from "../../types.js";
import type { ToolVisibilityBase } from "@vex-agent/tools/registry.js";

export interface TurnLoopConfig {
  maxIterations: number;
  timeoutMs: number;
  contextLimit: number;
  /**
   * Static visibility axes (permission, role, sessionKind, missionRunActive)
   * the runner knows up-front. `buildTurnPromptStack` augments this per turn
   * with the live band + `hasSessionMemory` to build the SINGLE
   * `ToolVisibilityContext` that drives BOTH the tools array and the Tool Map.
   */
  baseVisibility?: ToolVisibilityBase;
}

export interface TurnLoopResult {
  text: string | null;
  toolCallsMade: number;
  pendingApprovals: string[];
  stopReason: StopReason | null;
  /** Structured stop payload — summary/evidence from mission_stop or complete_subagent. */
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> };
}
