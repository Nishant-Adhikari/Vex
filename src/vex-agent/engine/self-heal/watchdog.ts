/**
 * Overnight self-heal watchdog — the periodic + boot tick that keeps an
 * unattended multi-hour mission alive across provider outages (OV2) and
 * paused_wake stalls (OV3) with NO human.
 *
 * DESIGN: this module is pure orchestration over an injected `SelfHealDeps`
 * (all DB / engine IO is a dep) so the whole decision matrix is unit-testable
 * with no network and no DB. The vex-app wiring supplies the real deps and the
 * non-reentrant supervisor loop (mirrors `regime-worker` / `exit-watch-wiring`).
 *
 * OV2 (paused_error, provider outage):
 *   For each `paused_error` run that is TRANSIENT + SAFE + FULL-mode + within
 *   its DEADLINE/cost bound, and has NO retry wake already pending (so we defer
 *   to the fast Phase-4d retries and never double-fire), schedule the next
 *   minutes-scale self-heal retry wake — reusing the durable `error_retry_count`
 *   epoch + the wake executor as the single serialized resume authority. Beyond
 *   `SELF_HEAL_FAILOVER_THRESHOLD` consecutive failures the wake is stamped to
 *   fail over to the backup model. Past the deadline / attempt ceiling we STOP
 *   scheduling and leave the run for the abandoned-run reaper / a human.
 *
 * OV3 (paused_wake, wake stall):
 *   For each `paused_wake` run whose scheduled wake is overdue by a margin (or,
 *   with no wake row, whose last checkpoint is that stale), re-arm a fresh
 *   due-now wake so the executor resumes it. Bounded: after
 *   `MAX_WAKE_STALL_ATTEMPTS` resumes with NO iteration progress, finalize the
 *   run cleanly rather than looping forever.
 *
 * SAFETY: every gate is fail-closed; the watchdog only ever SCHEDULES/RESUMES —
 * the atomic authority (kill switch, unsafe stamp, permission, deadline, epoch)
 * is re-verified under a row lock in `claimRunForSelfHeal` at resume time, so a
 * human Recover racing the watchdog always wins. The tick itself is fail-soft:
 * a per-run error is logged and skipped; one bad run never stalls the sweep.
 */

import type { MissionRun } from "../../db/repos/mission-runs.js";
import type { LoopWakeRequest } from "../../db/repos/loop-wake.js";
import logger from "@utils/logger.js";

import {
  MAX_SELF_HEAL_ATTEMPTS,
  MAX_WAKE_STALL_ATTEMPTS,
  WAKE_STALL_MARGIN_MS,
  selfHealEnabled,
  selfHealBackoffMs,
  shouldFailover,
  resolveFallbackModel,
  evidenceIsTransient,
} from "./policy.js";
import { withinRecoveryBounds, type RunCostReader } from "./bounds.js";
import type { ScheduledSelfHealRetry } from "./schedule.js";

// ── Injected IO ─────────────────────────────────────────────────────

export interface SelfHealDeps {
  /** Clock (ms). Injectable for deterministic tests. */
  now(): number;
  /**
   * Provider-readiness gate — the SAME condition the wake executor uses to
   * decide whether to claim due wakes (OPENROUTER_API_KEY + AGENT_MODEL in env,
   * injected by the vault on unlock). When it is closed (vault locked / key not
   * yet injected) the executor intentionally leaves paused_wake wakes PENDING,
   * so the watchdog must NOT treat those as stalled and finalize the run —
   * gate the whole tick on it, exactly like the executor.
   */
  isProviderReady(): boolean;
  /** Every run currently in `status`, oldest-first. */
  listRunsByStatus(status: MissionRun["status"]): Promise<MissionRun[]>;
  /** Live session permission ("full" gates OV2). Null when the session is gone. */
  getSessionPermission(sessionId: string): Promise<string | null>;
  /**
   * Run-scoped LLM spend (USD) for the cost-cap recovery bound — the SAME
   * `getSessionTotalCost(sessionId, { since })` the turn-loop enforcer reads.
   * Injected so the decision matrix stays DB-free in tests. `since` is the run's
   * immutable `started_at`, so a run counts only its own spend.
   */
  getRunCost: RunCostReader;
  /** The current pending wake for a session, if any (OV3 stall probe). */
  getPendingWake(sessionId: string): Promise<LoopWakeRequest | null>;
  /**
   * OV2 — ATOMICALLY schedule the next self-heal retry (epoch bump + wake insert
   * in one tx, insert-first so a losing enqueue never strands the epoch).
   * `null` when a retry is already pending or the run left paused_error.
   */
  scheduleErrorRetry(input: {
    runId: string;
    sessionId: string;
    dueAt: Date;
    reason: string;
    failover: boolean;
  }): Promise<ScheduledSelfHealRetry | null>;
  /** Enqueue a pending wake; `null` when one already exists for the session. */
  enqueueWake(input: {
    sessionId: string;
    missionRunId: string;
    dueAt: Date;
    reason: string;
    payload: Record<string, unknown>;
  }): Promise<LoopWakeRequest | null>;
  /** Cancel every pending wake for a session (OV3 re-arm). Returns count. */
  cancelPendingWakes(sessionId: string): Promise<number>;
  /**
   * Finalize an unrecoverable paused_wake run — race-safe: finalizes ONLY while
   * the run is still `paused_wake`. Returns true when THIS call finalized it.
   */
  finalizeStalledWake(
    runId: string,
    summary: string,
    evidence: Record<string, unknown>,
  ): Promise<boolean>;
  /**
   * OV3-NO-LIQUIDATION fix: flatten open positions for a stalled paused_wake
   * run BEFORE finalizing so tokens bought by the mission are sold back to ETH
   * rather than stranded. Fully fail-soft — must never throw.
   */
  flattenStalledWakePositions(args: { missionId: string; runId: string; sessionId: string }): Promise<void>;
}

export interface SelfHealTickResult {
  readonly scheduled: number; // OV2 retry wakes enqueued
  readonly wakeResumed: number; // OV3 stalls re-armed
  readonly finalized: number; // OV3 exhausted → finalized
  readonly skipped: number; // ineligible / not-yet-due
  readonly errors: number; // per-run failures (fail-soft)
}

const EMPTY: SelfHealTickResult = {
  scheduled: 0,
  wakeResumed: 0,
  finalized: 0,
  skipped: 0,
  errors: 0,
};

// ── Watchdog factory (holds OV3 in-memory attempt bookkeeping) ──────

interface WakeStallState {
  attempts: number;
  lastIterationCount: number;
}

export interface SelfHealWatchdog {
  /** Run one OV2 + OV3 sweep. Fail-soft; never throws. */
  tick(): Promise<SelfHealTickResult>;
  /** Test seam: clear OV3 in-memory state. */
  __resetState(): void;
}

export function createSelfHealWatchdog(deps: SelfHealDeps): SelfHealWatchdog {
  // OV2 recovery is durable (error_retry_count + wake rows survive restart).
  // OV3 stall bounding is per-app-session in memory: a restart is itself a
  // change of world, and re-evaluating a stalled wake fresh after a restart is
  // correct (it gets a fresh bounded budget). Keyed by runId.
  const stallState = new Map<string, WakeStallState>();

  async function tick(): Promise<SelfHealTickResult> {
    // KILL SWITCH — disabled reverts to today's park-and-wait (no-op).
    if (!selfHealEnabled()) return EMPTY;
    // PROVIDER GATE — when the executor can't resume (vault locked / key not
    // injected), pending wakes are intentionally parked; do nothing so we never
    // re-arm or finalize a run the executor was never given a chance to resume.
    if (!deps.isProviderReady()) return EMPTY;

    let ov2: SelfHealTickResult;
    let ov3: SelfHealTickResult;
    try {
      ov2 = await sweepPausedError();
    } catch (err) {
      logger.error("engine.self_heal.ov2_sweep_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      ov2 = { ...EMPTY, errors: 1 };
    }
    try {
      ov3 = await sweepPausedWake();
    } catch (err) {
      logger.error("engine.self_heal.ov3_sweep_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      ov3 = { ...EMPTY, errors: 1 };
    }
    return {
      scheduled: ov2.scheduled + ov3.scheduled,
      wakeResumed: ov2.wakeResumed + ov3.wakeResumed,
      finalized: ov2.finalized + ov3.finalized,
      skipped: ov2.skipped + ov3.skipped,
      errors: ov2.errors + ov3.errors,
    };
  }

  // ── OV2 ──────────────────────────────────────────────────────────

  async function sweepPausedError(): Promise<SelfHealTickResult> {
    const runs = await deps.listRunsByStatus("paused_error");
    const nowMs = deps.now();
    const hasFallback = resolveFallbackModel() !== null;
    let scheduled = 0;
    let skipped = 0;
    let errors = 0;

    for (const run of runs) {
      try {
        // Gate 1 — TRANSIENT only. A permanent / unclassified error stays
        // paused_error for a human.
        if (run.stopReason !== "provider_error" || !evidenceIsTransient(run.stopEvidenceJson)) {
          skipped++;
          continue;
        }
        // Gate 2 — NO half-completed irreversible action (sticky unsafe stamp).
        if (run.autoRetryUnsafe === true) {
          skipped++;
          continue;
        }
        // Gate 3 — deadline + COST bound. Past either: STOP scheduling and leave
        // the run for the abandoned-run reaper / a human. This is the OV2 half of
        // the reaper↔self-heal LADDER: once a run is past its box or at/over its
        // dollar cap, OV2 arms no further wake, so the reaper (which skips any run
        // with a pending self_heal_retry wake) is finally free to finalize it.
        if (
          !(await withinRecoveryBounds(
            { startedAt: run.startedAt, contractSnapshotJson: run.contractSnapshotJson },
            nowMs,
            run.sessionId,
            { costReader: deps.getRunCost },
          ))
        ) {
          skipped++;
          continue;
        }
        // Bounded attempts — defense-in-depth beneath the deadline.
        if (run.errorRetryCount >= MAX_SELF_HEAL_ATTEMPTS) {
          skipped++;
          continue;
        }
        // Full-mode only (unattended autonomous). The claim re-checks this too.
        const permission = await deps.getSessionPermission(run.sessionId);
        if (permission !== "full") {
          skipped++;
          continue;
        }

        const priorFailures = run.errorRetryCount;
        const backoffMs = selfHealBackoffMs(priorFailures);
        const failover = shouldFailover(priorFailures, hasFallback);
        const dueAt = new Date(nowMs + backoffMs);
        // Atomic: epoch bump + wake insert in one tx (insert-first, increment
        // only if it won the pending-wake slot). `null` = a retry is already
        // pending (defer, spaces the ladder + yields to the fast Phase-4d wake)
        // or the run left paused_error — either way no epoch is touched.
        const result = await deps.scheduleErrorRetry({
          runId: run.id,
          sessionId: run.sessionId,
          dueAt,
          reason: "self_heal retry (transient provider error)",
          failover,
        });
        if (result === null) {
          skipped++;
          continue;
        }
        scheduled++;
        logger.info("engine.self_heal.retry_scheduled", {
          runId: run.id,
          sessionId: run.sessionId,
          attempt: result.attempt,
          backoffMs,
          failover,
          dueAt: dueAt.toISOString(),
        });
      } catch (err) {
        errors++;
        logger.error("engine.self_heal.ov2_run_failed", {
          runId: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { scheduled, wakeResumed: 0, finalized: 0, skipped, errors };
  }

  // ── OV3 ──────────────────────────────────────────────────────────

  async function sweepPausedWake(): Promise<SelfHealTickResult> {
    const runs = await deps.listRunsByStatus("paused_wake");
    const nowMs = deps.now();
    // Prune bookkeeping for runs no longer paused_wake (recovered / terminal).
    const liveIds = new Set(runs.map((r) => r.id));
    for (const id of stallState.keys()) {
      if (!liveIds.has(id)) stallState.delete(id);
    }

    let wakeResumed = 0;
    let finalized = 0;
    let skipped = 0;
    let errors = 0;

    for (const run of runs) {
      try {
        const pending = await deps.getPendingWake(run.sessionId);
        // Staleness reference: the scheduled wake time if a wake still exists,
        // else the run's last checkpoint (when it last ran), else its start.
        const refMs = pending !== null
          ? Date.parse(pending.dueAt)
          : run.lastCheckpointAt
            ? Date.parse(run.lastCheckpointAt)
            : Date.parse(run.startedAt);
        const overdueBy = Number.isFinite(refMs) ? nowMs - refMs : 0;
        if (!(overdueBy > WAKE_STALL_MARGIN_MS)) {
          skipped++;
          continue; // fresh / not yet stale — the executor still owns it
        }

        const state = stallState.get(run.id) ?? {
          attempts: 0,
          lastIterationCount: run.iterationCount,
        };
        // Iteration progress since the last resume attempt → a resume DID run a
        // turn (legitimate re-park); reset the bounded budget.
        const progressed = run.iterationCount > state.lastIterationCount;
        if (progressed) state.attempts = 0;
        state.lastIterationCount = run.iterationCount;

        if (state.attempts >= MAX_WAKE_STALL_ATTEMPTS) {
          const summary =
            `Mission wake stalled: ${state.attempts} resume attempts made no progress; finalized by self-heal.`;
          // OV3-NO-LIQUIDATION fix: flatten open positions BEFORE finalizing so
          // tokens the mission bought are sold back to ETH, not stranded.
          await deps.flattenStalledWakePositions({
            missionId: run.missionId,
            runId: run.id,
            sessionId: run.sessionId,
          });
          const did = await deps.finalizeStalledWake(run.id, summary, {
            selfHealWakeStall: {
              attempts: state.attempts,
              lastIterationCount: state.lastIterationCount,
              finalizedAt: new Date(nowMs).toISOString(),
            },
          });
          stallState.delete(run.id);
          if (did) {
            finalized++;
            logger.warn("engine.self_heal.wake_stall_finalized", {
              runId: run.id,
              sessionId: run.sessionId,
              attempts: state.attempts,
            });
          } else {
            skipped++; // raced to non-paused_wake — someone else resolved it
          }
          continue;
        }

        // Re-arm: cancel any overdue-stuck pending wake, then enqueue a fresh
        // due-now wake the executor resumes via the normal paused_wake path.
        await deps.cancelPendingWakes(run.sessionId);
        const wake = await deps.enqueueWake({
          sessionId: run.sessionId,
          missionRunId: run.id,
          dueAt: new Date(nowMs),
          reason: "self_heal wake-stall resume",
          payload: { trigger: "wake_stall_resume", attempt: state.attempts + 1 },
        });
        state.attempts += 1;
        stallState.set(run.id, state);
        if (wake !== null) {
          wakeResumed++;
          logger.info("engine.self_heal.wake_stall_rearmed", {
            runId: run.id,
            sessionId: run.sessionId,
            attempt: state.attempts,
            overdueByMs: overdueBy,
          });
        } else {
          skipped++;
        }
      } catch (err) {
        errors++;
        logger.error("engine.self_heal.ov3_run_failed", {
          runId: run.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return { scheduled: 0, wakeResumed, finalized, skipped, errors };
  }

  return {
    tick,
    __resetState: () => stallState.clear(),
  };
}
