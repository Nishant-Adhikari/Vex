/**
 * Mission internal tool handlers — mission draft updates and mission_stop.
 *
 * mission_stop is the only model-driven way to stop a mission.
 * Returns an engineSignal that the turn-loop uses to finalize the run.
 * Replaces text-parsed [STOP: reason] markers.
 */

import { z } from "zod";

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, fail } from "./types.js";
import type { BusinessStopReason } from "@vex-agent/engine/types.js";
import { applyMissionPatch } from "@vex-agent/engine/mission/setup.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";

const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_ARRAY_ITEM_LENGTH = 500;

const MissionDraftUpdateArgs = z
  .object({
    title: z.string().trim().min(1).max(MAX_STRING_LENGTH).nullable().optional(),
    goal: z.string().trim().min(1).max(MAX_STRING_LENGTH).nullable().optional(),
    capitalSource: z.string().trim().min(1).max(MAX_STRING_LENGTH).nullable().optional(),
    startingCapital: z.string().trim().min(1).max(MAX_STRING_LENGTH).nullable().optional(),
    allowedWallets: z.array(z.string().trim().min(1).max(MAX_ARRAY_ITEM_LENGTH)).max(MAX_ARRAY_ITEMS).nullable().optional(),
    allowedChains: z.array(z.string().trim().min(1).max(MAX_ARRAY_ITEM_LENGTH)).max(MAX_ARRAY_ITEMS).nullable().optional(),
    allowedProtocols: z.array(z.string().trim().min(1).max(MAX_ARRAY_ITEM_LENGTH)).max(MAX_ARRAY_ITEMS).nullable().optional(),
    riskProfile: z.string().trim().min(1).max(MAX_STRING_LENGTH).nullable().optional(),
    successCriteria: z.array(z.string().trim().min(1).max(MAX_ARRAY_ITEM_LENGTH)).max(MAX_ARRAY_ITEMS).nullable().optional(),
    stopConditions: z.array(z.string().trim().min(1).max(MAX_ARRAY_ITEM_LENGTH)).max(MAX_ARRAY_ITEMS).nullable().optional(),
    deadline: z.string().trim().min(1).max(MAX_STRING_LENGTH).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => Object.values(value).some((v) => v !== undefined),
    { message: "Provide at least one mission draft field to update" },
  );

const VALID_STOP_REASONS = new Set<string>([
  "goal_reached",
  "deadline_reached",
  "capital_depleted",
  "max_loss_hit",
  "no_viable_opportunity",
]);

export async function handleMissionDraftUpdate(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  if (context.sessionKind !== "mission" || context.missionRunId !== null) {
    return fail("mission_draft_update is only valid during mission setup or edit");
  }
  if (!context.missionId) {
    return fail("mission_draft_update requires an existing mission draft");
  }

  const parsed = MissionDraftUpdateArgs.safeParse(params);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    return fail(`mission_draft_update: ${firstIssue?.message ?? "invalid arguments"}`);
  }

  const result = await applyMissionPatch(context.missionId, parsed.data);
  const latestRun = result.ready ? await missionRunsRepo.getRunBySession(context.sessionId) : null;
  const nextCommand = result.ready ? (latestRun ? "/mission continue" : "/mission start") : null;

  return {
    success: true,
    output: JSON.stringify({
      missionId: result.missionId,
      status: result.status,
      ready: result.ready,
      missingFields: result.missingFields,
      currentDraft: result.currentDraft,
      nextCommand,
    }, null, 2),
    data: {
      missionId: result.missionId,
      status: result.status,
      ready: result.ready,
      missingFields: result.missingFields,
      currentDraft: result.currentDraft,
      nextCommand,
    },
  };
}

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
