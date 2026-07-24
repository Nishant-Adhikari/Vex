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
import { closeRunnerLostFinalize } from "./mission-finalize.js";
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
  /**
   * Race-safe claim: flip `running`→`stopped(runner_lost)` ONLY while the run
   * is still `running` AND has no live lease. `true` = THIS pass won the run
   * (proceed to flatten + finalize); `false` = it was resumed / already
   * terminal (skip — never touch a run someone else now owns).
   */
  claim: (runId: string, stopPayload: { summary: string }) => Promise<boolean>;
  flatten: (args: {
    missionId: string;
    runId: string;
    sessionId: string;
  }) => Promise<void>;
  /** The finalize tail — mission→cancelled, control-state emit, ledger close. */
  closeLedger: (
    missionId: string,
    runId: string,
    sessionId: string,
  ) => Promise<void>;
  dropStaleLease: (sessionId: string) => Promise<number>;
}

function defaultDeps(): ReconcileDeps {
  return {
    findOrphans: () => missionRunsRepo.findOrphanedRunningRuns(),
    claim: (runId, stopPayload) =>
      missionRunsRepo.markStoppedIfRunning(runId, RUNNER_LOST_STOP_REASON, stopPayload),
    flatten: (a) => flattenInterruptedRunPositions(a),
    closeLedger: (missionId, runId, sessionId) =>
      closeRunnerLostFinalize(missionId, runId, sessionId),
    dropStaleLease: (sessionId) =>
      runnerLeasesRepo.releaseExpiredLease(sessionId),
  };
}

// In-process guard so the boot pass and a periodic tick (same electron_main
// process) never double-process the same orphan concurrently — belt-and-braces
// on top of the DB-level guarded claim in `markStoppedIfRunning`.
const inFlight = new Set<string>();

/**
 * Reconcile a single orphaned run: CLAIM it race-safely, then flatten its
 * positions, close the ledger, and drop the stale lease.
 *
 * Order matters. The claim (`markStoppedIfRunning`: `running` + no live lease →
 * `stopped(runner_lost)`) runs FIRST so nothing is flattened or finalized
 * unless we atomically won the run against a concurrent operator Resume — that
 * closes the race Codex flagged (a resume acquires a fresh lease while keeping
 * status `running`; our lease-aware guard then refuses the flip). Only after
 * winning do we flatten (the run's frozen snapshot keeps the exit executable
 * post-claim) and close the ledger via the shared finalize tail.
 */
async function reconcileOne(
  run: MissionRun,
  deps: ReconcileDeps,
): Promise<"reconciled" | "skipped" | "failed"> {
  if (inFlight.has(run.id)) return "skipped";
  inFlight.add(run.id);
  try {
    const won = await deps.claim(run.id, { summary: RUNNER_LOST_SUMMARY });
    if (!won) {
      // Resumed by the operator, already terminal, or won by another pass —
      // never touch a run we don't exclusively own.
      logger.info("engine.mission.reconcile_skip_claim_lost", {
        runId: run.id,
        sessionId: run.sessionId,
      });
      return "skipped";
    }

    // We now exclusively own the run (it is `stopped`). Flatten its open
    // positions back to ETH so it ends flat, then run the shared finalize tail
    // (mission→cancelled, control-state emit, ledger close). Flatten is
    // fail-soft; the run is already terminal so a flatten hiccup never re-opens
    // it.
    await deps.flatten({
      missionId: run.missionId,
      runId: run.id,
      sessionId: run.sessionId,
    });
    await deps.closeLedger(run.missionId, run.id, run.sessionId);

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
