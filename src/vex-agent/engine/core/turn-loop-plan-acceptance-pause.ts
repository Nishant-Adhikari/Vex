/**
 * Post-batch handling for the `plan_pause` engine signal — a `plan_write` in an
 * active mission run created/changed a plan that is not user-accepted.
 *
 * Flips the mission run to `paused_plan_acceptance` with the
 * `plan_acceptance_required` stop reason. Resume is gated on plan ACCEPTANCE:
 * refused while the plan is unaccepted; once accepted it resumes via the
 * `plan.accept` IPC OR any control resume path. It is a RUNTIME_PAUSE but NOT a
 * RESUMABLE_STOP, so a plain user chat message never resumes it. Unlike
 * `waiting_for_wake` there is no forced-compact-before-wait — acceptance is a
 * user action, not a timed wake.
 *
 * The runner's `finally` (releaseLeaseAndEmitControlState) emits the resulting
 * control state, so no explicit emit is needed here (mirrors
 * `applyWaitingForWakePostBatch`).
 */

import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";

export async function applyPlanAcceptancePausePostBatch(args: {
  readonly missionRunId: string | null;
}): Promise<void> {
  if (args.missionRunId !== null) {
    await missionRunsRepo.updateStatus(
      args.missionRunId,
      "paused_plan_acceptance",
      "plan_acceptance_required",
    );
  }
}
