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
import { closeRunnerLostFinalize, closeReapedErrorFinalize } from "./mission-finalize.js";
import { flattenInterruptedRunPositions } from "./mission-liquidate-hook.js";

/** Distinct stop reason stamped on a reclaimed orphan (auditable in the ledger). */
export const RUNNER_LOST_STOP_REASON = "runner_lost" as const;

/** Distinct stop reason stamped on a reaped, abandoned paused_error run. */
export const REAPED_STALE_ERROR_STOP_REASON = "reaped_stale_error" as const;

const RUNNER_LOST_SUMMARY =
  "Run interrupted — its runner lease expired with no worker re-acquiring it " +
  "(app restart or runner process death). Reclaimed by the orphaned-run reconciler.";

const REAPED_STALE_ERROR_SUMMARY =
  "Run abandoned in `paused_error` — no live runner lease, no pending auto-retry " +
  "wake, 0 open positions, and stale for the grace window, with no operator " +
  "recovery. Auto-finalized by the stale-error reaper so a new mission can start " +
  "in this session (a recoverable run is never reaped).";

/**
 * Grace window (minutes) a `paused_error` run must sit UNTOUCHED — no live lease,
 * no pending wake — before it is eligible for reaping. Comfortably longer than
 * the auto-retry back-off (≤ ~32 s) and a normal manual-Recover reaction window,
 * so only a genuinely-stuck run is ever finalized.
 */
export const PAUSED_ERROR_REAP_GRACE_MINUTES = 30;

export interface ReconcileOrphanedRunsSummary {
  /** Orphaned runs the selection query returned this pass. */
  scanned: number;
  /** Runs this pass finalized to `runner_lost` (won the guarded claim). */
  reconciled: number;
  /** Runs another pass / a live finalize had already moved out of `running`. */
  skipped: number;
  /** Runs whose finalize threw (logged; never rethrown). */
  failed: number;
  /**
   * Expired `runner_leases` rows reclaimed by the GLOBAL boot sweep (BUG B) —
   * standalone dead leases (blank `mission_run_id`, or a `paused_error` session)
   * that the per-orphan lease drop never reaches. 0 when the sweep is disabled
   * or finds none.
   */
  leasesSwept: number;
  /**
   * Abandoned `paused_error` runs REAPED this pass (BUG C) — no live lease AND 0
   * open positions, so a new mission can start without a human clearing the DB.
   * A run holding a live lease or an open position is NEVER counted here.
   */
  staleErrorsReaped: number;
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
  /**
   * GLOBAL sweep (BUG B): DELETE every expired `runner_leases` row regardless of
   * associated run — including a standalone lease with a blank `mission_run_id`
   * or a `paused_error` session — that the per-orphan `dropStaleLease` never
   * reaches. Owner-agnostic, guarded on expiry, idempotent. Returns rows deleted.
   */
  sweepExpiredLeases: () => Promise<number>;
  /** Abandoned `paused_error` runs (no live lease) — reaper candidates (BUG C). */
  findAbandonedPausedErrors: () => Promise<MissionRun[]>;
  /**
   * Open-position count for a run's mission wallet — the CONSERVATIVE reaper
   * guard (BUG C). A non-zero count (or a thrown read) preserves the run for
   * Recover; only a confirmed 0 lets it be reaped.
   */
  countRunOpenPositions: (run: MissionRun) => Promise<number>;
  /**
   * Race-safe reap flip: `paused_error` → `failed(reaped_stale_error)` ONLY
   * while still `paused_error` AND no live lease. `true` = THIS pass won it.
   */
  reapStaleError: (
    runId: string,
    stopPayload: { summary: string },
  ) => Promise<boolean>;
  /** The reaper finalize tail — mission→failed, control-state emit, ledger close. */
  closeReapedLedger: (
    missionId: string,
    runId: string,
    sessionId: string,
  ) => Promise<void>;
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
    sweepExpiredLeases: () => runnerLeasesRepo.releaseAllExpiredLeases(),
    findAbandonedPausedErrors: () =>
      missionRunsRepo.findAbandonedPausedErrorRuns(
        PAUSED_ERROR_REAP_GRACE_MINUTES,
      ),
    countRunOpenPositions: (run) => countRunOpenPositions(run),
    reapStaleError: (runId, stopPayload) =>
      missionRunsRepo.markStaleErrorReaped(
        runId,
        REAPED_STALE_ERROR_STOP_REASON,
        stopPayload,
      ),
    closeReapedLedger: (missionId, runId, sessionId) =>
      closeReapedErrorFinalize(missionId, runId, sessionId),
  };
}

/**
 * Default open-position count for a run's mission wallet. Reads the CHEAP
 * projections (no RPC): spot token bags from `proj_balances` (via the ETH
 * bankroll fold) PLUS tracked perps/predictions/LP/order positions from
 * `proj_open_positions`. A run with ANY of these is still holding value and must
 * stay recoverable — never reaped. Lazily imports the heavier deps so this
 * foundational module keeps a light static graph.
 *
 * THROWS on any UNKNOWN position state — an unresolvable wallet/chain, or a
 * bankroll read that FAILED (`readEthBankroll` returns `null`). An unknown count
 * must never collapse to a confirmed 0: `reapOne` fail-CLOSES on a throw, so a
 * transient read failure or an unsynced bag preserves the run for Recover rather
 * than letting it be reaped. Only a CONFIRMED read (non-null bankroll) yields a
 * count the reaper may act on.
 */
async function countRunOpenPositions(run: MissionRun): Promise<number> {
  const [{ getMission }, { readEthBankroll }, { getOpen }, { resolveLocalChainId }] =
    await Promise.all([
      import("@vex-agent/db/repos/missions.js"),
      import("../../mission/bankroll.js"),
      import("@vex-agent/db/repos/open-positions.js"),
      import("../../../../tools/evm-chains/registry.js"),
    ]);
  const mission = await getMission(run.missionId);
  const wallet = mission?.allowedWallets[0];
  const chainKey = mission?.allowedChains[0];
  if (!wallet || !chainKey) {
    throw new Error(
      `reaper: unresolved mission wallet/chain for run ${run.id} — position state unknown`,
    );
  }
  const chainId = resolveLocalChainId(chainKey);
  if (chainId === undefined) {
    throw new Error(
      `reaper: unresolved chain '${chainKey}' for run ${run.id} — position state unknown`,
    );
  }
  // A NULL bankroll means the read FAILED (not "0 positions") — treat as unknown.
  const bankroll = await readEthBankroll(wallet, chainId);
  if (bankroll === null) {
    throw new Error(
      `reaper: bankroll read failed for run ${run.id} — position state unknown`,
    );
  }
  const tracked = await getOpen([wallet]);
  return bankroll.openPositions.length + tracked.length;
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
 * Reap a single ABANDONED paused_error run: verify 0 open positions, then CLAIM
 * it race-safely (`paused_error` → `failed(reaped_stale_error)`, only while no
 * live lease reappeared) and close the ledger. CONSERVATIVE — a run with ANY
 * open position, or whose position read THROWS, is preserved (never reaped) so
 * the user can still Recover it. Returns whether this pass reaped it.
 */
async function reapOne(run: MissionRun, deps: ReconcileDeps): Promise<boolean> {
  if (inFlight.has(run.id)) return false;
  inFlight.add(run.id);
  try {
    let openPositions: number;
    try {
      openPositions = await deps.countRunOpenPositions(run);
    } catch (err) {
      // Fail-CLOSED: an unknown position state must never let us reap a run that
      // might still hold a bag. Preserve it for Recover.
      logger.warn("engine.mission.reap_skip_positions_unknown", {
        runId: run.id,
        sessionId: run.sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
    if (openPositions > 0) {
      logger.info("engine.mission.reap_skip_open_positions", {
        runId: run.id,
        sessionId: run.sessionId,
        openPositions,
      });
      return false;
    }

    const won = await deps.reapStaleError(run.id, {
      summary: REAPED_STALE_ERROR_SUMMARY,
    });
    if (!won) {
      // Recovered by the operator, already terminal, or a live lease reappeared —
      // never touch a run we don't exclusively own.
      logger.info("engine.mission.reap_skip_claim_lost", {
        runId: run.id,
        sessionId: run.sessionId,
      });
      return false;
    }

    await deps.closeReapedLedger(run.missionId, run.id, run.sessionId);
    // Clear the leftover expired lease for a clean session (idempotent; the
    // global sweep also covers it).
    await deps.dropStaleLease(run.sessionId);

    logger.info("engine.mission.reap_finalized", {
      runId: run.id,
      missionId: run.missionId,
      sessionId: run.sessionId,
    });
    return true;
  } catch (err) {
    logger.error("engine.mission.reap_failed", {
      runId: run.id,
      sessionId: run.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  } finally {
    inFlight.delete(run.id);
  }
}

/**
 * Reconcile ALL wedged mission state on boot / interval. Runs THREE independent,
 * fail-soft passes so one failure never blocks the others (and no early return
 * skips a later pass):
 *
 *   1. GLOBAL expired-lease sweep (BUG B) — reclaims standalone dead leases the
 *      per-orphan drop never reaches; the direct fix for the `lease_busy` wedge.
 *   2. Orphaned RUNNING-run reconcile — claim → flatten → finalize `runner_lost`.
 *   3. Abandoned paused_error REAP (BUG C) — finalize a `paused_error` run only
 *      when clearly abandoned (no live lease AND 0 open positions).
 *
 * Never throws — any pass's scan/finalize failure resolves fail-soft.
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
    leasesSwept: 0,
    staleErrorsReaped: 0,
  };

  // ── Pass 1: GLOBAL expired-lease sweep (BUG B). Independent of any run. ──
  try {
    summary.leasesSwept = await deps.sweepExpiredLeases();
    if (summary.leasesSwept > 0) {
      logger.info("engine.mission.reconcile_leases_swept", {
        leasesSwept: summary.leasesSwept,
      });
    }
  } catch (err) {
    logger.error("engine.mission.reconcile_lease_sweep_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // ── Pass 2: orphaned RUNNING-run reconcile. ──
  let orphans: MissionRun[] = [];
  try {
    orphans = await deps.findOrphans();
  } catch (err) {
    logger.error("engine.mission.reconcile_scan_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  summary.scanned = orphans.length;
  if (orphans.length > 0) {
    logger.info("engine.mission.reconcile_scan", { orphans: orphans.length });
    for (const run of orphans) {
      const outcome = await reconcileOne(run, deps);
      summary[outcome] += 1;
    }
  }

  // ── Pass 3: abandoned paused_error REAP (BUG C). ──
  let stale: MissionRun[] = [];
  try {
    stale = await deps.findAbandonedPausedErrors();
  } catch (err) {
    logger.error("engine.mission.reap_scan_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
  if (stale.length > 0) {
    logger.info("engine.mission.reap_scan", { candidates: stale.length });
    for (const run of stale) {
      if (await reapOne(run, deps)) summary.staleErrorsReaped += 1;
    }
  }

  logger.info("engine.mission.reconcile_done", {
    scanned: summary.scanned,
    reconciled: summary.reconciled,
    skipped: summary.skipped,
    failed: summary.failed,
    leasesSwept: summary.leasesSwept,
    staleErrorsReaped: summary.staleErrorsReaped,
  });
  return summary;
}
