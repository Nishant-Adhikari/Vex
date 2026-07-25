/**
 * Overnight self-heal wiring — the supervised watchdog loop.
 *
 * Owns the engine's self-heal watchdog (`@vex-agent/engine/self-heal/watchdog`)
 * for the live desktop app: a non-reentrant, fail-soft periodic tick that
 * recovers provider-outage `paused_error` runs (OV2) and stalled `paused_wake`
 * runs (OV3) with no human. The watchdog itself only SCHEDULES/RE-ARMS wake
 * rows — the wake executor remains the single serialized resume authority — so
 * this tick is lightweight (a few reads + at most one enqueue per run) and
 * never blocks on an agent turn.
 *
 * Lifecycle mirrors `exit-watch-wiring` / `regime-worker`: tick immediately at
 * boot (restart-durable re-arm of any in-deadline paused_error run) and every
 * interval after, gated on the engine DB url being resolvable. `stop()` is
 * idempotent + non-reentrant and drains any in-flight tick before resolving.
 *
 * DEFAULT-ON, kill-switchable via `AGENT_SELF_HEAL_ENABLED` (the watchdog tick
 * itself no-ops when disabled, so this loop can spin harmlessly either way).
 */

import { randomUUID } from "node:crypto";
import {
  createSelfHealWatchdog,
  type SelfHealDeps,
  type SelfHealWatchdog,
} from "@vex-agent/engine/self-heal/watchdog.js";
import { SELF_HEAL_TICK_INTERVAL_MS } from "@vex-agent/engine/self-heal/policy.js";
import { scheduleSelfHealRetry } from "@vex-agent/engine/self-heal/schedule.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import { getSession } from "@vex-agent/db/repos/sessions.js";
import { isWakeProviderConfigured } from "@vex-agent/engine/wake/executor.js";
import { log } from "../logger/index.js";
import { ensureEngineDbUrl } from "../ipc/runtime/_ensure-engine-db-url.js";

// ── Real deps ────────────────────────────────────────────────────

export function createSelfHealDeps(): SelfHealDeps {
  return {
    now: () => Date.now(),
    // Same provider gate the wake executor uses to decide whether to claim.
    isProviderReady: () => isWakeProviderConfigured(),
    listRunsByStatus: (status) => missionRunsRepo.listRunsByStatus(status),
    getSessionPermission: async (sessionId) => {
      const session = await getSession(sessionId);
      return session ? session.permission : null;
    },
    getPendingWake: (sessionId) => loopWakeRepo.getPendingForSession(sessionId),
    scheduleErrorRetry: (input) => scheduleSelfHealRetry(input),
    enqueueWake: (input) =>
      loopWakeRepo.enqueue({
        sessionId: input.sessionId,
        missionRunId: input.missionRunId,
        dueAt: input.dueAt,
        reason: input.reason,
        payload: input.payload,
      }),
    cancelPendingWakes: (sessionId) =>
      loopWakeRepo.cancelForSession(sessionId, "self_heal_wake_stall_rearm"),
    finalizeStalledWake: (runId, summary, evidence) =>
      missionRunsRepo.markPausedWakeFailed(runId, { summary, evidence }),
  };
}

// ── Supervisor ───────────────────────────────────────────────────

export interface SelfHealSupervisorDeps {
  /** Point the engine pool at local Postgres; `{ ok }` gates the first tick. */
  readonly ensureDbUrl: (correlationId: string) => Promise<{ readonly ok: boolean }>;
  /** Build the watchdog (test override). */
  readonly makeWatchdog: () => SelfHealWatchdog;
  /** Tick cadence (test override). */
  readonly intervalMs: number;
}

/**
 * Start the supervised self-heal watchdog. Returns an idempotent async `stop`
 * for the ordered quit cleanup. Non-reentrant: a single in-flight tick guard
 * (`inFlightTick`) prevents overlapping sweeps; the DB-url gate is re-checked
 * every tick so the loop stays a cheap no-op until the pool is up.
 */
export function setupSelfHealWorker(
  deps: Partial<SelfHealSupervisorDeps> = {},
): () => Promise<void> {
  const intervalMs = deps.intervalMs ?? SELF_HEAL_TICK_INTERVAL_MS;
  const ensureDbUrl =
    deps.ensureDbUrl ??
    (async (correlationId: string) => {
      const r = await ensureEngineDbUrl(correlationId);
      return { ok: r.ok };
    });
  const watchdog = (deps.makeWatchdog ?? (() => createSelfHealWatchdog(createSelfHealDeps())))();

  let stopped = false;
  let dbReady = false;
  let warnedWaiting = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlightTick: Promise<void> | null = null;

  const runTick = async (): Promise<void> => {
    if (stopped) return;
    if (!dbReady) {
      const dbUrl = await ensureDbUrl(`self-heal-${randomUUID()}`);
      if (stopped) return;
      if (!dbUrl.ok) {
        if (!warnedWaiting) {
          warnedWaiting = true;
          log.info("[self-heal] waiting to start: database url unavailable");
        }
        return;
      }
      dbReady = true;
      log.info("[self-heal] watchdog active (OV2 provider-outage + OV3 wake-stall)");
    }
    // Fail-soft: watchdog.tick() never throws, but guard anyway so a supervisor
    // bug can never crash the app or the quit drain.
    const result = await watchdog.tick();
    if (result.scheduled + result.wakeResumed + result.finalized + result.errors > 0) {
      log.info("[self-heal] tick", { ...result });
    }
  };

  const scheduleTick = (): void => {
    if (stopped || inFlightTick !== null) return;
    inFlightTick = runTick()
      .catch((err) => {
        log.warn("[self-heal] tick failed", err);
      })
      .finally(() => {
        inFlightTick = null;
      });
  };

  // Immediate boot tick (restart-durable re-arm) + steady cadence.
  scheduleTick();
  timer = setInterval(scheduleTick, intervalMs);

  return async function stop(): Promise<void> {
    stopped = true;
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    if (inFlightTick !== null) {
      try {
        await inFlightTick;
      } catch {
        // already logged in scheduleTick
      }
    }
  };
}
