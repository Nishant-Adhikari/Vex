/**
 * Production wiring for the deadline watchdog.
 *
 * Split out of `deadline-watchdog.ts` (which stays a pure, DB-free unit) so the
 * sweep can be unit-tested with injected fakes while production builds its deps
 * from the real repos + engine surfaces here — the same split as
 * `wake/executor.ts` vs `wake/executor/deps.ts`.
 *
 * `emitControlState` mirrors `runner/mission-finalize.ts`'s post-finalize
 * control-state broadcast so a watchdog-stopped run reaches the renderer with
 * the canonical terminal status + cleared lease, exactly like the loop-boundary
 * path. It re-reads canonical state and is fully fail-soft.
 */

import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import * as runnerLeasesRepo from "@vex-agent/db/repos/runner-leases.js";
import { captureMissionFinal } from "../mission/mission-results-capture.js";
import { resolveRunHardDeadlineMs } from "../mission/mission-deadline.js";
import { rejectPendingApprovalsForSession } from "../core/runner/approvals-cleanup.js";
import type { DeadlineWatchdogDeps } from "./deadline-watchdog.js";

async function emitControlState(sessionId: string, runId: string): Promise<void> {
  try {
    const { controlStateBus, CONTROL_STATE_EVENT_TYPE } = await import(
      "../runtime/control-bus.js"
    );
    const run = await missionRunsRepo.getRun(runId);
    if (run === null) return;
    const lease = await runnerLeasesRepo.getLease(sessionId);
    const leaseActive = lease !== null && lease.expiresAt >= new Date();
    controlStateBus.emit({
      type: CONTROL_STATE_EVENT_TYPE,
      sessionId,
      missionRunId: runId,
      runStatus: run.status,
      stopReason: run.stopReason ?? null,
      pendingControlKind: null,
      leaseActive,
      leaseExpiresAt: leaseActive ? lease!.expiresAt.toISOString() : null,
      correlationId: null,
    });
  } catch {
    // Fail-soft — a bus error must never break the sweep.
  }
}

export function buildProductionDeadlineWatchdogDeps(): DeadlineWatchdogDeps {
  return {
    listCandidateRuns: () => missionRunsRepo.listActiveOrPausedRuns(),
    resolveDeadlineMs: (run) => resolveRunHardDeadlineMs(run),
    getLease: (sessionId) => runnerLeasesRepo.getLease(sessionId),
    casStopPastDeadline: (runId, fromStatuses, payload) =>
      missionRunsRepo.casStopPastDeadline(runId, fromStatuses, payload),
    rejectPendingApprovals: (sessionId) => rejectPendingApprovalsForSession(sessionId),
    setMissionFailed: (missionId) => missionsRepo.setStatus(missionId, "failed"),
    captureTimedOut: (args) => captureMissionFinal({ ...args, outcome: "timed_out" }),
    emitControlState,
  };
}
