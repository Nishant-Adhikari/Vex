/**
 * Wake executor — single-process scheduler that drives `loop_defer` wakes.
 *
 * Contract:
 *   - Exactly ONE process runs the executor per deployment. Race safety
 *     across ticks is provided by `loopWakeRepo.claimDue` (FOR UPDATE SKIP
 *     LOCKED). Mission-run wake resumes also claim the run row with a CAS
 *     before injecting the wake banner, so `/retry` and wake cannot both
 *     resume the same stale `paused_wake` snapshot.
 *   - The desktop-agent host should start one process-local executor with
 *     hardcoded defaults (interval=2000ms, batchSize=10) after DB bootstrap.
 *     Wake is an installed-runtime concern, not a renderer concern.
 *
 * Tick semantics:
 *   1. `claimDue(now, batchSize)` — atomically flips the pending rows to
 *      `consumed` and returns them. Rows the executor cannot handle (e.g.
 *      session status drifted to `running` because a user preempted) are
 *      SKIPPED but NOT unclaimed — the row is terminal once consumed, and
 *      the race is accepted (the user already resumed the session, so no
 *      banner needs to be injected).
 *   2. For every claimed row, the executor re-checks the mission run state
 *      and either (a) injects a `wake_due` banner + triggers the resume
 *      path or (b) logs the drift and skips. Every outcome is reported on
 *      the returned `ClaimedWake` so tests and operators can see the result.
 *
 * Post-M12 simplification: `full_autonomous` mode is gone. Every wake row
 * targets a mission run; the executor no longer branches on `wake.kind`.
 *
 * Structural split: this file is the compatibility façade + lifecycle owner.
 * The tick implementation lives under `./executor/`:
 *
 *   deps.ts       — `WakeDeps` + production default deps wiring.
 *   tick.ts       — `tick` + `ClaimedWake` / `ClaimedWakeOutcome`.
 *   claimed.ts    — normal claimed-job handling (`handleClaimed`).
 *   auto-retry.ts — auto-retry handling (`handleAutoRetryClaimed`).
 *   provider.ts   — `isWakeProviderConfigured`.
 *
 * `startWakeExecutor` + `WakeExecutorHandle` + `StartOptions` stay here as the
 * self-scheduling lifecycle owner so the setTimeout chain, in-flight drain, and
 * stop() teardown remain in one place.
 */

import logger from "@utils/logger.js";

import { tick } from "./executor/tick.js";
import { buildProductionDeps, type WakeDeps } from "./executor/deps.js";
import {
  sweepMissionDeadlines,
  type DeadlineWatchdogDeps,
} from "./deadline-watchdog.js";
import { buildProductionDeadlineWatchdogDeps } from "./deadline-watchdog-deps.js";

export type { ClaimedWakeOutcome, ClaimedWake } from "./executor/tick.js";
export { tick } from "./executor/tick.js";
export type { WakeDeps } from "./executor/deps.js";
export { isWakeProviderConfigured } from "./executor/provider.js";

// ── Scheduler ──────────────────────────────────────────────────────

export interface WakeExecutorHandle {
  /** Stop the executor. Resolves after the in-flight tick (if any) settles. */
  stop(): Promise<void>;
}

export interface StartOptions {
  intervalMs?: number;
  batchSize?: number;
  deps?: WakeDeps;
  now?: () => Date;
  /**
   * Injected deadline-watchdog deps (tests). Production builds them from the
   * real repos. The watchdog sweep piggybacks on this scheduler's timer so a
   * PARKED run past its hard deadline is stopped even though it never reaches
   * the turn-loop boundary — see `deadline-watchdog.ts`.
   */
  deadlineWatchdogDeps?: DeadlineWatchdogDeps;
}

/**
 * Start the executor's polling loop. Defaults: interval 2000ms, batch 10.
 * Defaults are hardcoded — no env-driven override — so a stale
 * `AGENT_WAKE_ENABLED=false` from an older install cannot disable wake.
 * Pass `deps`/`now` in tests to inject fakes without touching the real DB.
 *
 * `stop()` drains any currently-running tick before resolving, so hosts can
 * await a clean shutdown.
 */
export function startWakeExecutor(options: StartOptions = {}): WakeExecutorHandle {
  const interval = options.intervalMs ?? 2000;
  const limit = options.batchSize ?? 10;
  const now = options.now ?? (() => new Date());
  const deps = options.deps ?? buildProductionDeps();
  const deadlineWatchdogDeps =
    options.deadlineWatchdogDeps ?? buildProductionDeadlineWatchdogDeps();

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;

  const runOne = async (): Promise<void> => {
    const at = now();
    // Deadline watchdog first, and independent of `tick`: stopping a past-
    // deadline run needs NO inference provider (unlike a wake resume), so it
    // must run even when `tick` early-returns on an absent provider — otherwise
    // a parked run could ghost past its box until the key is loaded. Its own
    // try/catch so a sweep failure never blocks the wake pass (and vice versa).
    try {
      await sweepMissionDeadlines(at, deadlineWatchdogDeps);
    } catch (err) {
      logger.error("wake.executor.deadline_sweep_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      await tick(at, limit, deps);
    } catch (err) {
      logger.error("wake.executor.tick_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    inFlight = runOne().finally(() => {
      inFlight = null;
      if (!stopped) {
        timer = setTimeout(schedule, interval);
      }
    });
  };

  timer = setTimeout(schedule, interval);
  logger.info("wake.executor.started", { intervalMs: interval, batchSize: limit });

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          // Already logged inside runOne — swallow so shutdown doesn't throw.
        }
      }
      logger.info("wake.executor.stopped");
    },
  };
}
