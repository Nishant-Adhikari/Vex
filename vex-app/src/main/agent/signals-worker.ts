/**
 * Signals-ingest worker ownership.
 *
 * Electron main owns the signals-ingest executor so TrendRadar's hourly alpha
 * feed actually drains into Vex's own `signals` table — the data a mission's
 * SIGNAL RADAR prompt block reads. Like the sync worker it makes no inference
 * calls; it does PUBLIC network reads (the feed) + a DB upsert, so it can start
 * before the vault is unlocked. The only start gate is this supervisor proving
 * Postgres + the `signals` table (migration 037) are ready — the executor ticks
 * HOURLY, so a first tick against a not-yet-migrated DB would fail and sit idle
 * for an hour.
 *
 * Lifecycle mirrors `sync-worker.ts`: tick immediately then every
 * `SUPERVISOR_INTERVAL_MS` until the DB is ready, then start the executor
 * EXACTLY ONCE and clear the interval (it self-schedules thereafter). `stop()`
 * is non-reentrant and idempotent, and is sequenced before Postgres teardown via
 * `makeOrderedQuitCleanup` in `index.ts`.
 */

import { randomUUID } from "node:crypto";
import type { SignalsIngestExecutorHandle } from "@vex-agent/signals/executor.js";
import { log } from "../logger/index.js";
import { probeSignalsReady } from "../database/signals-db.js";
import { ensureEngineDbUrl } from "../ipc/runtime/_ensure-engine-db-url.js";

const SUPERVISOR_INTERVAL_MS = 30_000;

export interface SignalsWorkerDeps {
  /** Point the engine pool at local Postgres; `{ ok }` gates start. */
  readonly ensureDbUrl: (
    correlationId: string,
  ) => Promise<{ readonly ok: boolean }>;
  /** Prove Postgres reachable + `signals` table migrated before starting. */
  readonly probeReady: () => Promise<boolean>;
  /** Start the engine's signals-ingest executor (narrow dynamic import). */
  readonly startExecutor: () => Promise<SignalsIngestExecutorHandle>;
  /** Supervisor poll cadence (test override). */
  readonly intervalMs: number;
}

async function defaultStartExecutor(): Promise<SignalsIngestExecutorHandle> {
  // Narrow import (not the engine barrel) to keep the runner graph out of the
  // supervisor's import chain. `startSignalsIngestExecutor` is synchronous; the
  // async wrapper keeps the dep type `() => Promise<...>`.
  const { startSignalsIngestExecutor } = await import(
    "@vex-agent/signals/executor.js"
  );
  // Auto-grade newly-ingested signals after each tick via the SAME LLM-as-judge
  // path the per-row GRADE button uses (`autoGradeIngestedSignals` → `gradeSignal`).
  // It is idempotent (grades only `grade IS NULL` rows), fail-soft per signal,
  // and capped per pass — see `../signals/auto-grade.ts`. Fully swallowed by the
  // executor's post-tick hook so it can never disturb ingest.
  const { autoGradeIngestedSignals } = await import("../signals/auto-grade.js");
  return startSignalsIngestExecutor({
    afterIngest: async () => {
      await autoGradeIngestedSignals();
    },
  });
}

/**
 * Start the supervised signals-ingest worker. Returns an idempotent async `stop`
 * for the ordered quit cleanup. Deps are injectable for tests; production uses
 * the real DB-url helper, schema probe, and narrow executor import.
 */
export function setupSignalsIngestWorker(
  deps: Partial<SignalsWorkerDeps> = {},
): () => Promise<void> {
  const intervalMs = deps.intervalMs ?? SUPERVISOR_INTERVAL_MS;
  const ensureDbUrl =
    deps.ensureDbUrl ??
    ((correlationId: string) => ensureEngineDbUrl(correlationId));
  const probeReady = deps.probeReady ?? probeSignalsReady;
  const startExecutor = deps.startExecutor ?? defaultStartExecutor;

  let stopped = false;
  let started = false;
  let handle: SignalsIngestExecutorHandle | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlightTick: Promise<void> | null = null;
  let warnedWaiting = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const warnWaitingOnce = (reason: string): void => {
    if (warnedWaiting) return;
    warnedWaiting = true;
    log.info(`[signals-worker] waiting to start: ${reason}`);
  };

  const tick = async (): Promise<void> => {
    if (stopped || started) return;

    const dbUrl = await ensureDbUrl(`signals-worker-supervisor-${randomUUID()}`);
    if (stopped || started) return; // re-check after await (non-reentrant)
    if (!dbUrl.ok) {
      warnWaitingOnce("database url unavailable");
      return;
    }

    const ready = await probeReady();
    if (stopped || started) return; // re-check after await
    if (!ready) {
      warnWaitingOnce("signals table not ready");
      return;
    }

    const live = await startExecutor();
    started = true;
    clearTimer();
    // stop() may have raced in during `startExecutor`'s await — if so, tear down
    // the executor we just created so quit never leaves a live worker.
    if (stopped) {
      await live.stop();
      return;
    }
    handle = live;
    log.info("[signals-worker] signals-ingest executor started");
  };

  const scheduleTick = (): void => {
    // Single in-flight tick: a slow tick must not be lapped by the interval.
    if (stopped || started || inFlightTick !== null) return;
    inFlightTick = tick()
      .catch((err) => {
        log.warn("[signals-worker] supervisor tick failed", err);
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
    if (handle !== null) {
      const live = handle;
      handle = null;
      await live.stop();
    }
  };
}
