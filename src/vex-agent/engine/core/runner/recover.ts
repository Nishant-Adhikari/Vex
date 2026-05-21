/**
 * Failed mission recovery.
 *
 * A failed run is immutable audit history. Recovery creates a new run from the
 * failed run's frozen contract snapshot and links it through
 * `recovered_from_run_id`.
 */

import type { TurnResult } from "../../types.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import { appendEngineMessage } from "@vex-agent/engine/events/index.js";
import { requireMissionPromptContextFromSnapshot } from "../../mission/run-contract.js";

export async function recoverFailedMissionRun(sessionId: string): Promise<TurnResult> {
  const active = await missionRunsRepo.getActiveRunBySession(sessionId);
  if (active) {
    throw new Error(`Mission run ${active.id} is still active (${active.status}); stop or finish it before recovery.`);
  }

  const failed = await missionRunsRepo.getLatestFailedRunBySession(sessionId);
  if (!failed) {
    throw new Error("No failed mission run found for this session.");
  }

  // Validate before mutating mission/run state.
  requireMissionPromptContextFromSnapshot(failed.contractSnapshotJson);

  const mission = await missionsRepo.getMission(failed.missionId);
  if (!mission) {
    throw new Error(`Mission ${failed.missionId} not found for failed run ${failed.id}.`);
  }

  // Puzzle 03 — claim session lease BEFORE the first state mutation
  // (codex blocker #2). A concurrent `requestResume` / `startMission`
  // / chat submit on the same session must not interleave with the
  // mission flip + new-run create + activation message.
  const ownerId = `recover-${failed.id}`;
  const { claimSessionLease } = await import(
    "@vex-agent/engine/runtime/lease-and-status.js"
  );
  const claim = await claimSessionLease({
    sessionId,
    ownerId,
    processKind: "electron_main",
    ttlMs: 5 * 60_000,
  });
  if (claim.outcome === "lease_busy") {
    throw new Error(
      `Session ${sessionId} runner lease busy — another runner is active.`,
    );
  }
  const { createLeaseHandle } = await import(
    "@vex-agent/engine/runtime/lease-handle.js"
  );
  const sessionLease = createLeaseHandle({
    lease: claim.lease,
    ownerId,
    ttlMs: 5 * 60_000,
  });

  let createdRunId: string | null = null;
  try {
    await missionsRepo.setStatus(mission.id, "running");
    await missionsRepo.setApprovedAt(mission.id);

    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    createdRunId = runId;
    await missionRunsRepo.createRun(runId, mission.id, sessionId, {
      contractSnapshotJson: failed.contractSnapshotJson,
      recoveredFromRunId: failed.id,
    });

    await appendEngineMessage(
      sessionId,
      [
        "[Engine: mission_recovered — The operator requested recovery from a failed mission run.",
        "This is a new run using the failed run's frozen Mission Contract.",
        "The old failed run remains terminal audit history. Execute the recovered Mission Contract now.]",
      ].join(" "),
      {
        source: "engine",
        messageType: "mission_recovered",
        visibility: "internal",
        payload: {
          missionId: mission.id,
          recoveredRunId: runId,
          recoveredFromRunId: failed.id,
        },
      },
    );

    const { resumeMissionRun } = await import("./mission.js");
    return await resumeMissionRun(runId);
  } finally {
    const { releaseLeaseAndEmitControlState } = await import(
      "@vex-agent/engine/runtime/release-and-emit.js"
    );
    await releaseLeaseAndEmitControlState(sessionLease, sessionId, {
      // Pass the created runId so the post-release event references the
      // recovered run even after it lands in a terminal status that the
      // active-run lookup would filter out (codex non-blocking cleanup).
      missionRunId: createdRunId,
    });
  }
}
