/**
 * Signals-ingest executor — process-lifetime loop that polls the TrendRadar feed
 * hourly and upserts into Vex's `signals` table. Mirrors `sync/executor.ts`: a
 * self-scheduling setTimeout loop, errors caught + logged (a bad fetch never
 * kills the loop), and a `stop()` that settles any in-flight tick.
 */

import { ingestSignalsFeed, DEFAULT_SIGNALS_FEED_URL } from "./ingest.js";
import logger from "@utils/logger.js";

export interface SignalsIngestExecutorHandle {
  stop(): Promise<void>;
}

export interface SignalsIngestDeps {
  ingest(): Promise<void>;
}

export interface SignalsIngestStartOptions {
  /** Poll cadence. Defaults to hourly — matches the feed's publish cadence. */
  intervalMs?: number;
  /** Feed URL override (env/tests). */
  url?: string;
  /** Dependency injection for tests. */
  deps?: SignalsIngestDeps;
  /**
   * Optional post-tick hook — runs AFTER each ingest attempt (Electron main
   * injects the signals auto-grader here). It runs whether or not the ingest
   * itself succeeded, so a feed hiccup still lets the grader drain any backlog
   * of ungraded rows. FAIL-SOFT: its errors are caught + logged and never kill
   * the loop.
   *
   * The `signal` aborts when `stop()` is called: the hook must stop launching
   * new work promptly so app-quit cleanup (which awaits the in-flight tick) is
   * never held hostage by a slow post-tick pass (e.g. a stalled LLM provider).
   */
  afterIngest?: (signal: AbortSignal) => Promise<void>;
}

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000; // 1h

export function startSignalsIngestExecutor(
  options: SignalsIngestStartOptions = {},
): SignalsIngestExecutorHandle {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const url = options.url ?? DEFAULT_SIGNALS_FEED_URL;
  const deps: SignalsIngestDeps = options.deps ?? {
    ingest: async () => { await ingestSignalsFeed(url); },
  };

  let stopped = false;
  let inFlight: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  // Aborts on stop() so the post-tick hook can bail out fast during shutdown
  // instead of holding quit cleanup for a full (possibly slow) grading pass.
  const abort = new AbortController();

  const runOne = async (): Promise<void> => {
    try {
      await deps.ingest();
    } catch (err) {
      logger.warn("signals.executor.tick_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    // Post-tick hook (auto-grade). Independently fail-soft: it runs even after
    // an ingest failure (to drain a backlog) and its own error never kills the
    // loop or masks a preceding ingest error.
    if (options.afterIngest !== undefined && !abort.signal.aborted) {
      try {
        await options.afterIngest(abort.signal);
      } catch (err) {
        logger.warn("signals.executor.after_ingest_failed", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  };

  const schedule = (delayMs: number): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      inFlight = runOne().finally(() => {
        inFlight = null;
        schedule(intervalMs);
      });
    }, delayMs);
  };

  schedule(0);
  logger.info("signals.executor.started", { intervalMs });

  return {
    async stop(): Promise<void> {
      stopped = true;
      // Signal the post-tick hook to wind down BEFORE we await the in-flight
      // tick, so a slow grading pass can't stall quit cleanup.
      abort.abort();
      if (timer) clearTimeout(timer);
      if (inFlight) {
        try {
          await inFlight;
        } catch {
          // already logged by runOne
        }
      }
      logger.info("signals.executor.stopped");
    },
  };
}
