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
  /**
   * Hard mission time-box as an absolute epoch (ms). When set, the turn loop
   * stops with `deadline_reached` the moment `Date.now() >= missionDeadlineMs`,
   * independent of the agent — checked first each iteration, before another
   * inference call is spent. Computed from the run's immutable `started_at` +
   * the configured duration (see `engine/mission/mission-deadline.ts`).
   * Null/undefined = no box.
   */
  missionDeadlineMs?: number | null;
  /**
   * Hard cumulative token budget for the mission run (whole tokens). When set,
   * the turn loop stops with `token_budget_exhausted` the moment the phase's
   * accumulated prompt+completion spend (the summed `usage_log.total_tokens`
   * for the session subtree, scoped by `missionTokenSince`) is at or above this
   * ceiling — checked at the top of each iteration, after the previous turn's
   * usage was recorded and BEFORE another inference call is spent. Resolved from
   * `AGENT_MISSION_TOKEN_BUDGET` (default 500000). Null/undefined = no budget
   * (guard disabled — explicit `0`/`off`/… sentinel or an unconfigured phase).
   */
  missionTokenBudget?: number | null;
  /**
   * Baseline cutoff (ISO timestamp) that scopes the budget to a single PHASE.
   * The accumulator sums only usage rows with `created_at >= missionTokenSince`,
   * so a RUN counts only the tokens it spent itself — not the setup/recovery
   * tokens already logged to the same root session before the run started. The
   * run passes its IMMUTABLE `started_at` (identical across resume, so the same
   * baseline is reused and pre-pause run spend still counts). Null/undefined =
   * all-time (the setup phase, whose baseline is the session's own start).
   */
  missionTokenSince?: string | null;
}

export interface TurnLoopResult {
  text: string | null;
  toolCallsMade: number;
  pendingApprovals: string[];
  stopReason: StopReason | null;
  /** Structured stop payload — summary/evidence from mission_stop or complete_subagent. */
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> };
}
