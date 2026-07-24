/**
 * Simulator scheduler worker — the desktop supervisor for hands-free paper
 * missions. When enabled, it auto-launches a NEW simulator mission on an
 * interval so the shadow ledger accumulates lots of independent
 * pick→trade→outcome samples with zero operator involvement.
 *
 * DISABLED BY DEFAULT (`VEX_SIM_SCHEDULER_ENABLED` gates every tick). Easy to
 * turn off: unset the env var (or set it falsey) and no launch ever fires.
 *
 * SAFETY:
 *   - Every launched mission is `mission_mode='simulator'`, so its run freezes
 *     `mode='simulator'` and NEVER broadcasts (paper-fill + the two no-broadcast
 *     layers). It cannot touch a real wallet.
 *   - CONCURRENCY CAP: before launching, the worker counts active simulator runs
 *     (`countActiveRunsByMode('simulator')`) and skips the tick if already at
 *     `maxConcurrent`, so it never stacks unbounded concurrent sims.
 *   - FAIL-SOFT + non-reentrant: a tick that is still in flight is never
 *     re-entered; any error is logged and swallowed. `stop()` is idempotent and
 *     awaits the in-flight tick so quit never races a launch.
 *
 * Lifecycle mirrors `orphan-reconciler-worker.ts`: waits (no-op) until the
 * engine DB url resolves, then ticks on the configured interval.
 */

import { randomUUID } from "node:crypto";
import { log } from "../logger/index.js";
import { ensureEngineDbUrl } from "../ipc/runtime/_ensure-engine-db-url.js";
import {
  resolveSimulatorSchedulerConfig,
  buildSimulatorMissionSeed,
  type SimulatorSchedulerConfig,
} from "./simulator-scheduler-config.js";

export interface SimulatorSchedulerDeps {
  /** Resolve the current config (env-backed by default; injectable for tests). */
  readonly getConfig: () => SimulatorSchedulerConfig;
  /** Point the engine pool at local Postgres; `{ ok }` gates the tick. */
  readonly ensureDbUrl: (correlationId: string) => Promise<{ readonly ok: boolean }>;
  /** Count active (running/paused) simulator runs — the concurrency gate. */
  readonly countActiveSims: () => Promise<number>;
  /** Launch one simulator mission from the seed. */
  readonly launch: (seed: Record<string, unknown>) => Promise<{ outcome: string }>;
  /** Base poll cadence in ms (test override). The effective cadence is
   *  `max(this, intervalMinutes*60_000)` so the config interval always wins. */
  readonly baseTickMs?: number;
}

async function defaultCountActiveSims(): Promise<number> {
  const { countActiveRunsByMode } = await import("@vex-agent/engine/index.js");
  return countActiveRunsByMode("simulator");
}

async function defaultLaunch(seed: Record<string, unknown>): Promise<{ outcome: string }> {
  const { launchScheduledSimulatorMission } = await import("@vex-agent/engine/index.js");
  return launchScheduledSimulatorMission({ seed });
}

/**
 * Start the simulator scheduler. Returns an idempotent async `stop` for the
 * ordered quit cleanup.
 */
export function setupSimulatorSchedulerWorker(
  deps: Partial<SimulatorSchedulerDeps> = {},
): () => Promise<void> {
  const getConfig = deps.getConfig ?? (() => resolveSimulatorSchedulerConfig());
  const ensureDbUrl =
    deps.ensureDbUrl ??
    (async (correlationId: string) => {
      const r = await ensureEngineDbUrl(correlationId);
      return { ok: r.ok };
    });
  const countActiveSims = deps.countActiveSims ?? defaultCountActiveSims;
  const launch = deps.launch ?? defaultLaunch;
  const baseTickMs = deps.baseTickMs ?? 60_000;

  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlightTick: Promise<void> | null = null;
  let lastLaunchAt = 0;
  let warnedWaiting = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  const tick = async (): Promise<void> => {
    if (stopped) return;
    const config = getConfig();
    if (!config.enabled) return;

    // The config interval governs launch cadence independently of the poll
    // cadence — a fast poll never launches faster than intervalMinutes.
    const intervalMs = config.intervalMinutes * 60_000;
    if (Date.now() - lastLaunchAt < intervalMs) return;

    const dbUrl = await ensureDbUrl(`sim-scheduler-${randomUUID()}`);
    if (stopped || !dbUrl.ok) {
      if (!dbUrl.ok && !warnedWaiting) {
        warnedWaiting = true;
        log.info("[sim-scheduler] waiting to launch: database url unavailable");
      }
      return;
    }

    // CONCURRENCY CAP — never stack more than `maxConcurrent` live sims.
    const active = await countActiveSims();
    if (active >= config.maxConcurrent) {
      log.info(
        `[sim-scheduler] at concurrency cap (${active}/${config.maxConcurrent}); skipping launch`,
      );
      // Advance the clock so we re-evaluate next interval, not every poll.
      lastLaunchAt = Date.now();
      return;
    }

    lastLaunchAt = Date.now();
    const seed = buildSimulatorMissionSeed(config);
    const result = await launch(seed);
    log.info(`[sim-scheduler] launch outcome=${result.outcome}`);
  };

  const scheduleTick = (): void => {
    if (stopped || inFlightTick !== null) return;
    inFlightTick = tick()
      .catch((err) => {
        log.warn("[sim-scheduler] tick failed", err);
      })
      .finally(() => {
        inFlightTick = null;
      });
  };

  scheduleTick();
  timer = setInterval(scheduleTick, baseTickMs);

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
