/**
 * Mission internal tool handlers — mission_stop.
 *
 * mission_stop is the only model-driven way to stop a mission.
 * Returns an engineSignal that the turn-loop uses to finalize the run.
 * Replaces text-parsed [STOP: reason] markers.
 */

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, ok, fail } from "./types.js";
import type { BusinessStopReason } from "@echo-agent/engine/types.js";

const VALID_STOP_REASONS = new Set<string>([
  "goal_reached",
  "deadline_reached",
  "capital_depleted",
  "max_loss_hit",
  "no_viable_opportunity",
]);

export async function handleMissionStop(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  // Guard: mission_stop only valid during an active mission run
  if (!context.missionRunId) {
    return fail("mission_stop is only valid during an active mission run");
  }

  const reason = str(params, "reason");
  const summary = str(params, "summary");

  if (!reason) return fail("Missing required: reason");
  if (!summary) return fail("Missing required: summary");

  if (!VALID_STOP_REASONS.has(reason)) {
    return fail(`Invalid stop reason "${reason}". Must be one of: ${[...VALID_STOP_REASONS].join(", ")}`);
  }

  const evidence = typeof params.evidence === "object" && params.evidence !== null
    ? params.evidence as Record<string, unknown>
    : undefined;

  return {
    success: true,
    output: `Mission stop requested: ${reason} — ${summary}`,
    data: { reason, summary, evidence },
    engineSignal: {
      type: "stop_mission",
      reason: reason as BusinessStopReason,
      summary,
      evidence,
    },
  };
}
