/**
 * Orphaned-run reconciler — the safety net for WEDGED mission runs.
 *
 * When the app restarts (or a runner process dies) mid-run, the in-flight run
 * ORPHANS: the `mission_runs` row stays `status='running'` with `ended_at=NULL`
 * while its `runner_leases` row EXPIRES and no worker re-acquires it. The run
 * then reads as RUNNING forever, STOP has no live loop to signal, and on the
 * NEXT boot the app would auto-resume it — burning tokens and possibly firing a
 * real trade the operator thought was dead.
 *
 * This module runs on boot (BEFORE any auto-resume path) and periodically. It
 * finds every such orphan and force-finalizes it to a DISTINCT terminal state
 * (`stop_reason='runner_lost'`, run status `stopped`) so it is auditable and
 * NEVER auto-resumed:
 *
 *   1. FLATTEN any open positions the mission opened (reuse the deadline
 *      liquidation core) so the run ends flat, not stranding a bag.
 *   2. FINALIZE via the shared `finalizeMissionRunStatus` path — the guarded
 *      (`WHERE status='running'`) flip closes the `mission_results` ledger row
 *      and sets the parent mission to `cancelled`.
 *   3. DROP the stale (expired) lease so a later resume/state read sees a clean
 *      session.
 *
 * A run WITH a live lease (genuinely executing) or a `paused_*` run is left
 * untouched — the selection query only returns `status='running'` runs whose
 * lease is missing/expired. Fully fail-soft and idempotent: a re-run finds the
 * already-finalized runs gone from the selection and does nothing.
 */

import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as runnerLeasesRepo from "@vex-agent/db/repos/runner-leases.js";
import logger from "@utils/logger.js";
import { finalizeMissionRunStatus } from "./mission-finalize.js";
import { flattenInterruptedRunPositions } from "./mission-liquidate-hook.js";

/** Distinct stop reason stamped on a reclaimed orphan (auditable in the ledger). */
export const RUNNER_LOST_STOP_REASON = "runner_lost" as const;

const RUNNER_LOST_SUMMARY =
  "Run interrupted — its runner lease expired with no worker re-acquiring it " +
  "(app restart or runner process death). Reclaimed by the orphaned-run reconciler.";

export interface ReconcileOrphanedRunsSummary {
  /** Orphaned runs the selection query returned this pass. */
  scanned: number;
  /** Runs this pass finalized to `runner_lost` (won the guarded claim). */
  reconciled: number;
  /** Runs another pass / a live finalize had already moved out of `running`. */
  skipped: number;
  /** Runs whose finalize threw (logged; never rethrown). */
  failed: number;
}

/**
 * Injectable seams — real repos/finalize/flatten by default; overridable in
 * tests so the selection/classification + force-finalize logic runs with no DB.
 */
export interface ReconcileDeps {
  findOrphans: () => Promise<MissionRun[]>;
  flatten: (args: {
    missionId: string;
    runId: string;
    sessionId: string;
  }) => Promise<void>;
  finalize: (
    missionId: string,
    runId: string,
    sessionId: string,
    stopReason: "runner_lost",
    stopPayload: { summary: string },
  ) => Promise<unknown>;
  dropStaleLease: (sessionId: string) => Promise<number>;
}

function defaultDeps(): ReconcileDeps {
  return {
    findOrphans: () => missionRunsRepo.findOrphanedRunningRuns(),
    flatten: (a) => flattenInterruptedRunPositions(a),
    finalize: (missionId, runId, sessionId, stopReason, stopPayload) =>
      finalizeMissionRunStatus(missionId, runId, sessionId, stopReason, stopPayload),
    dropStaleLease: (sessionId) =>
      runnerLeasesRepo.releaseExpiredLease(sessionId),
  };
}

// In-process guard so the boot pass and a periodic tick (same electron_main
// process) never double-process the same orphan concurrently — belt-and-braces
// on top of the DB-level guarded claim in `markStoppedIfRunning`.
const inFlight = new Set<string>();

/**
 * Reconcile a single orphaned run: flatten its positions, finalize to
 * `runner_lost`, then drop the stale lease. `finalize` (the shared
 * `finalizeMissionRunStatus` path) owns the guarded claim
 * (`WHERE status='running'`), the ledger close, the mission-status flip and the
 * control-state emit. The in-process guard here plus that DB-level guard mean a
 * run is flattened + finalized at most once.
 */
async function reconcileOne(
  run: MissionRun,
  deps: ReconcileDeps,
): Promise<"reconciled" | "skipped" | "failed"> {
  if (inFlight.has(run.id)) return "skipped";
  inFlight.add(run.id);
  try {
    // Flatten FIRST so the deadline liquidation core runs while the mission is
    // still hydratable as active (the finalize below flips it terminal). The
    // in-process guard prevents a concurrent tick from double-selling; the
    // liquidator is itself idempotent (re-reads current holdings). Fail-soft.
    await deps.flatten({
      missionId: run.missionId,
      runId: run.id,
      sessionId: run.sessionId,
    });

    // Reuse the shared finalize path — its guarded `markStoppedIfRunning`
    // (`WHERE status='running'`) is the idempotency source of truth: it closes
    // the `mission_results` ledger, sets the parent mission to `cancelled`, and
    // emits the terminal control state. A no-op if the run already went
    // terminal via another pass.
    await deps.finalize(
      run.missionId,
      run.id,
      run.sessionId,
      RUNNER_LOST_STOP_REASON,
      { summary: RUNNER_LOST_SUMMARY },
    );

    // Drop the leftover expired lease so a later getState/resume sees a clean
    // session (owner-agnostic, guarded on expiry — never touches a live lease).
    await deps.dropStaleLease(run.sessionId);

    logger.info("engine.mission.reconcile_finalized", {
      runId: run.id,
      missionId: run.missionId,
      sessionId: run.sessionId,
    });
    return "reconciled";
  } catch (err) {
    logger.error("engine.mission.reconcile_failed", {
      runId: run.id,
      sessionId: run.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return "failed";
  } finally {
    inFlight.delete(run.id);
  }
}

/**
 * Reconcile ALL orphaned runs. Safe to call on boot and on an interval. Each
 * run is finalized independently — one failure never aborts the sweep. Never
 * throws (a selection-query failure resolves to a zero summary).
 */
export async function reconcileOrphanedRuns(
  injected?: Partial<ReconcileDeps>,
): Promise<ReconcileOrphanedRunsSummary> {
  const deps: ReconcileDeps = { ...defaultDeps(), ...injected };
  const summary: ReconcileOrphanedRunsSummary = {
    scanned: 0,
    reconciled: 0,
    skipped: 0,
    failed: 0,
  };

  let orphans: MissionRun[];
  try {
    orphans = await deps.findOrphans();
  } catch (err) {
    logger.error("engine.mission.reconcile_scan_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return summary;
  }

  summary.scanned = orphans.length;
  if (orphans.length === 0) return summary;

  logger.info("engine.mission.reconcile_scan", { orphans: orphans.length });

  for (const run of orphans) {
    const outcome = await reconcileOne(run, deps);
    summary[outcome] += 1;
  }

  logger.info("engine.mission.reconcile_done", {
    scanned: summary.scanned,
    reconciled: summary.reconciled,
    skipped: summary.skipped,
    failed: summary.failed,
  });
  return summary;
}
