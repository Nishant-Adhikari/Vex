/**
 * Orphaned-run reconciler worker — the desktop-app supervisor for the engine's
 * `reconcileOrphanedRuns` sweep.
 *
 * WHY: when the app restarts (or a runner process dies) mid-mission the run
 * ORPHANS — `mission_runs.status='running'` with `ended_at=NULL`, its
 * `runner_leases` row expired, and no worker re-acquired it. Left alone the UI
 * shows it RUNNING forever, STOP has no live loop to signal, and the NEXT boot
 * would AUTO-RESUME it (burning tokens, possibly firing a real trade the user
 * thought was dead).
 *
 * WHAT: this worker runs the reconciler sweep as early as the engine DB is
 * reachable — BEFORE the wake worker (the auto-resume path) can act — and then
 * periodically as a safety net (a runner that dies while the app stays up also
 * orphans its run). Each sweep force-finalizes every orphan to `runner_lost`
 * (flatten + terminal `stopped`) so it is auditable and never auto-resumed.
 *
 * Lifecycle mirrors `exit-watch-wiring.ts`: tick immediately, then every
 * `intervalMs`; a boot tick waits (no-op) until the DB url resolves, then the
 * FIRST successful sweep runs and subsequent ticks keep sweeping on the
 * interval. `stop()` is idempotent + non-reentrant: it clears the interval and
 * awaits any in-flight sweep so quit never races a live reconcile.
 */

import { randomUUID } from "node:crypto";
import { log } from "../logger/index.js";
import { ensureEngineDbUrl } from "../ipc/runtime/_ensure-engine-db-url.js";

/** Default periodic sweep cadence — safety net for mid-uptime runner deaths. */
const RECONCILE_INTERVAL_MS = 60_000;

export interface OrphanReconcilerDeps {
  /** Point the engine pool at local Postgres; `{ ok }` gates the sweep. */
  readonly ensureDbUrl: (correlationId: string) => Promise<{ readonly ok: boolean }>;
  /** Run one reconcile sweep (engine `reconcileOrphanedRuns`). */
  readonly reconcile: () => Promise<{
    scanned: number;
    reconciled: number;
    skipped: number;
    failed: number;
  }>;
  /** Sweep cadence (test override). */
  readonly intervalMs: number;
}

async function defaultReconcile(): Promise<{
  scanned: number;
  reconciled: number;
  skipped: number;
  failed: number;
}> {
  const { reconcileOrphanedRuns } = await import("@vex-agent/engine/index.js");
  return reconcileOrphanedRuns();
}

/**
 * Start the supervised orphaned-run reconciler. Returns an idempotent async
 * `stop` for the ordered quit cleanup.
 */
export function setupOrphanReconcilerWorker(
  deps: Partial<OrphanReconcilerDeps> = {},
): () => Promise<void> {
  const intervalMs = deps.intervalMs ?? RECONCILE_INTERVAL_MS;
  const ensureDbUrl =
    deps.ensureDbUrl ??
    (async (correlationId: string) => {
      const r = await ensureEngineDbUrl(correlationId);
      return { ok: r.ok };
    });
  const reconcile = deps.reconcile ?? defaultReconcile;

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlightTick: Promise<void> | null = null;
  let warnedWaiting = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;

    const dbUrl = await ensureDbUrl(`orphan-reconciler-${randomUUID()}`);
    if (stopped || !dbUrl.ok) {
      if (!dbUrl.ok && !warnedWaiting) {
        warnedWaiting = true;
        log.info("[orphan-reconciler] waiting to sweep: database url unavailable");
      }
      return;
    }

    const summary = await reconcile();
    if (summary.scanned > 0 || summary.failed > 0) {
      log.info(
        `[orphan-reconciler] sweep scanned=${summary.scanned} ` +
          `reconciled=${summary.reconciled} skipped=${summary.skipped} ` +
          `failed=${summary.failed}`,
      );
    }
  };

  const scheduleTick = (): void => {
    if (stopped || inFlightTick !== null) return;
    inFlightTick = tick()
      .catch((err) => {
        log.warn("[orphan-reconciler] sweep tick failed", err);
      })
      .finally(() => {
        inFlightTick = null;
      });
  };

  scheduleTick();
  timer = setInterval(scheduleTick, intervalMs);

  return async function stop(): Promise<void> {
    stopped = true;
    clearTimer();
    if (inFlightTick !== null) {
      try {
        await inFlightTick;
      } catch {
        // already logged in scheduleTick
      }
    }
  };
}
