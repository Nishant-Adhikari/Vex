/**
 * Exit-watch worker — thin polling wrapper around the pure `runWatchCycle`.
 *
 * Phase C plumbing. This module owns NO business logic and does NO direct I/O:
 * every side effect (loading open positions, pricing, alert emission, peak
 * persistence) is supplied by the caller as an injected dependency. The wrapper
 * only sequences them on a timer:
 *
 *   each tick →  getOpenPositions()
 *             →  runWatchCycle(positions, priceOf, now, config)   [pure]
 *             →  emitAlert(alert)   for each alert
 *             →  savePeak(token, updatedPeak)   for each alert
 *
 * Loop discipline mirrors the engine's other workers (regime-worker): a
 * non-reentrant `setTimeout` chain rather than an overlapping `setInterval`, an
 * immediate first tick, and an idempotent teardown that awaits an in-flight
 * tick. A tick that throws is swallowed (logged via the injected `onError`, if
 * any) so a single bad poll can never kill the loop. Persisting peaks is
 * best-effort per token — one failed `savePeak` does not skip the rest.
 *
 * This wrapper is deliberately NOT wired into app boot; Phase D owns
 * construction of the real deps and the decision to start it.
 */

import { runWatchCycle, type WatchAlert, type WatchInputPosition } from "./watch-cycle.js";
import { type ExitConfig } from "./exit-rules.js";

/** Default poll cadence — one exit sweep per 15s. */
export const EXIT_WATCH_POLL_MS = 15_000;

export interface ExitWatchWorkerDeps {
  /** Load the currently-open positions to evaluate this tick. */
  getOpenPositions: () => Promise<readonly WatchInputPosition[]>;
  /** Current USD price for a token (sync); any failure degrades to unavailable. */
  priceOf: (token: string) => number | null | undefined;
  /** Surface one exit alert (persist / notify / enqueue execution downstream). */
  emitAlert: (alert: WatchAlert) => void | Promise<void>;
  /** Persist the refreshed high-water peak for the next cycle. */
  savePeak: (token: string, peakPriceUsd: number) => void | Promise<void>;
  /** Static exit configuration (ladder, stops, time-stop). */
  config: ExitConfig;
  /** Poll interval in ms. Default EXIT_WATCH_POLL_MS. */
  pollMs?: number;
  /** Wall-clock source, injectable for tests. Default Date.now. */
  now?: () => number;
  /** Optional error sink; a throwing tick is swallowed and reported here. */
  onError?: (err: unknown) => void;
}

/** Teardown handle — idempotent, awaits any in-flight tick. */
export type ExitWatchTeardown = () => Promise<void>;

/**
 * Run ONE watch tick against the injected deps. Exported for unit tests so the
 * sequencing (load → cycle → emit → persist) can be asserted without timers.
 * Rethrows nothing swallowed here — the caller (`setupExitWatchWorker`) owns
 * error handling; a direct caller may catch as it sees fit.
 */
export async function runExitWatchTick(deps: ExitWatchWorkerDeps): Promise<WatchAlert[]> {
  const now = deps.now ?? Date.now;
  const positions = await deps.getOpenPositions();
  const alerts = runWatchCycle(positions, deps.priceOf, now(), deps.config);

  for (const alert of alerts) {
    await deps.emitAlert(alert);
    // Peak persistence is best-effort per token: never let one failure abort
    // the rest of the sweep (a dropped peak self-heals next tick).
    try {
      await deps.savePeak(alert.token, alert.updatedPeakPriceUsd);
    } catch (err: unknown) {
      deps.onError?.(err);
    }
  }

  return alerts;
}

/**
 * Start the exit-watch poll loop and return an idempotent teardown fn.
 * Non-reentrant `setTimeout` chain (never overlapping): the next tick is armed
 * only after the current one settles. Ticks that throw are caught and routed to
 * `onError` so the loop survives transient failures. Teardown clears the timer
 * and awaits any in-flight tick.
 */
export function setupExitWatchWorker(deps: ExitWatchWorkerDeps): ExitWatchTeardown {
  const pollMs = deps.pollMs ?? EXIT_WATCH_POLL_MS;

  let stopped = false;
  let inFlight: Promise<unknown> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const tick = async (): Promise<void> => {
    try {
      await runExitWatchTick(deps);
    } catch (err: unknown) {
      deps.onError?.(err);
    }
  };

  const schedule = (): void => {
    if (stopped) return;
    inFlight = tick().finally(() => {
      inFlight = null;
      if (!stopped) timer = setTimeout(schedule, pollMs);
    });
  };

  schedule();

  return async function teardown(): Promise<void> {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (inFlight) await inFlight;
  };
}
