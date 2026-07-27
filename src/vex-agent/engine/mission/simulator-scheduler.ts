/**
 * Simulator scheduler — engine-side launcher for hands-free paper missions.
 *
 * The desktop boot worker (`vex-app/.../agent/simulator-scheduler-worker.ts`)
 * calls {@link launchScheduledSimulatorMission} on an interval to accumulate
 * lots of shadow-trade data. This module owns the full create → seed → accept →
 * start pipeline for ONE simulator mission, reusing the exact validated engine
 * paths a human launch uses:
 *
 *   1. create a `mode='mission'`, `permission='full'`, `mission_mode='simulator'`
 *      session + its companion mission draft,
 *   2. seed the draft through the validated `applyMissionPatch` pipeline,
 *   3. host-accept the contract (canonical hash recompute),
 *   4. `prepareMissionStart` (durable run row) + fire-and-forget the run loop.
 *
 * The run's mode is frozen `simulator` at createRun (from the session), so every
 * swap it makes is paper-filled and NO transaction is ever broadcast.
 *
 * SAFETY / concurrency: {@link launchScheduledSimulatorMission} is a single
 * launch; the WORKER enforces the concurrency cap (via `countActiveRunsByMode`)
 * and the enable/interval gating. This function is fail-returning, never
 * throwing on a rejected launch, so the worker stays fail-soft.
 */

import { randomUUID } from "node:crypto";

import * as sessionsRepo from "../../db/repos/sessions.js";
import * as missionsRepo from "../../db/repos/missions.js";
import { applyMissionPatch } from "./setup.js";
import { missionToDraft } from "./mapper.js";
import { computeContractHash, CONTRACT_HASH_VERSION } from "./contract-hash.js";
import { acceptContract } from "./acceptance.js";
import logger from "@utils/logger.js";

export interface LaunchSimulatorMissionInput {
  /**
   * A `MissionDraftSeed`-shaped object (title/goal/allowedChains/... ). Treated
   * as untrusted model-shaped input and re-sanitized by `applyMissionPatch`.
   * MUST include a non-empty `allowedWallets` (a placeholder sim address is
   * fine — the run never signs) so the draft reaches `ready`.
   */
  readonly seed: unknown;
}

export type LaunchSimulatorMissionOutcome =
  | { readonly outcome: "launched"; readonly sessionId: string; readonly missionId: string; readonly runId: string }
  | { readonly outcome: "not_ready"; readonly missingFields: readonly string[] }
  | { readonly outcome: "accept_failed"; readonly reason: string }
  | { readonly outcome: "start_failed"; readonly reason: string };

/**
 * Create + accept + start ONE simulator mission. Returns a structured outcome;
 * never throws on a rejected launch (infra errors still propagate so the worker
 * can log them).
 */
export async function launchScheduledSimulatorMission(
  input: LaunchSimulatorMissionInput,
): Promise<LaunchSimulatorMissionOutcome> {
  const sessionId = `sim-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const missionId = `mission-sim-${Date.now()}-${randomUUID().slice(0, 8)}`;

  // 1. Session (mission mode, full autonomy, SIMULATOR execution) + draft.
  await sessionsRepo.createSession(sessionId, {
    mode: "mission",
    permission: "full",
    missionMode: "simulator",
  });
  await missionsRepo.createDraft(missionId, sessionId);

  // 2. Seed the draft through the validated pipeline (sanitizes untrusted seed).
  const seeded = await applyMissionPatch(missionId, input.seed);
  if (!seeded.ready) {
    logger.warn("sim.scheduler.seed_not_ready", { missionId, missing: seeded.missingFields });
    return { outcome: "not_ready", missingFields: seeded.missingFields };
  }

  // 3. Host-accept the contract (recompute the canonical hash on the seeded row).
  const mission = await missionsRepo.getMission(missionId);
  if (!mission) return { outcome: "accept_failed", reason: "mission_disappeared" };
  const contractHash = computeContractHash(missionToDraft(mission), CONTRACT_HASH_VERSION);
  const accepted = await acceptContract({ sessionId, missionId, contractHash });
  if (accepted.outcome !== "accepted") {
    logger.warn("sim.scheduler.accept_failed", { missionId, outcome: accepted.outcome });
    return { outcome: "accept_failed", reason: accepted.outcome };
  }

  // 4. Prepare the durable run, then fire-and-forget the (long-running) loop.
  const { prepareMissionStart, runPreparedMissionStart } = await import(
    "../core/runner/mission.js"
  );
  const prepared = await prepareMissionStart({ missionId, sessionId });
  if (prepared.outcome !== "prepared") {
    logger.warn("sim.scheduler.start_failed", { missionId, outcome: prepared.outcome });
    return { outcome: "start_failed", reason: prepared.outcome };
  }
  const runId = prepared.prepared.runId;

  // Fire-and-forget — the loop runs for the mission's duration; the worker does
  // NOT block on it. Errors are the engine's own finalize concern; log only.
  void runPreparedMissionStart(prepared.prepared).catch((err: unknown) => {
    logger.warn("sim.scheduler.run_loop_failed", {
      runId,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logger.info("sim.scheduler.launched", { sessionId, missionId, runId });
  return { outcome: "launched", sessionId, missionId, runId };
}
