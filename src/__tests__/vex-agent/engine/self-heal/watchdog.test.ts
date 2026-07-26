/**
 * Overnight self-heal watchdog — the OV2 (provider-outage) + OV3 (wake-stall)
 * decision matrix. All IO is injected, so the whole safety matrix runs with no
 * DB and no network.
 *
 * Covers every mandated safety gate:
 *   - outage longer than the fast window → keeps re-arming across ticks
 *   - fails over to the backup model past the threshold (payload.failover)
 *   - recovery CEASES at the deadline
 *   - a NON-transient error is never scheduled
 *   - an irreversible-action-in-flight (unsafe stamp) is never scheduled
 *   - full-mode only; bounded attempt ceiling
 *   - restart-durable boot re-arm
 *   - kill switch off → no recovery
 *   - non-reentrant is a supervisor concern; here we prove fail-soft
 *   - OV3 overdue → resumed; repeatedly-stuck → finalized (bounded); progress
 *     resets the budget
 */
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createSelfHealWatchdog, type SelfHealDeps } from "@vex-agent/engine/self-heal/watchdog.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";
import type { LoopWakeRequest } from "@vex-agent/db/repos/loop-wake.js";
import {
  SELF_HEAL_FAILOVER_THRESHOLD,
  MAX_SELF_HEAL_ATTEMPTS,
  MAX_WAKE_STALL_ATTEMPTS,
  WAKE_STALL_MARGIN_MS,
} from "@vex-agent/engine/self-heal/policy.js";

const NOW = Date.parse("2026-07-25T02:00:00.000Z");
const START = "2026-07-25T01:30:00.000Z"; // 30m ago; 60m box → in-deadline

function run(over: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "run-1",
    missionId: "m-1",
    sessionId: "s-1",
    status: "paused_error",
    startedAt: START,
    endedAt: null,
    lastCheckpointAt: null,
    stopReason: "provider_error",
    stopSummary: "boom",
    stopEvidenceJson: { classified: "transient" },
    iterationCount: 3,
    contractSnapshotJson: { frozenMission: { constraintsJson: { durationMinutes: 60 } } },
    recoveredFromRunId: null,
    errorRetryCount: 0,
    autoRetryUnsafe: false,
    ...over,
  };
}

function wake(over: Partial<LoopWakeRequest> = {}): LoopWakeRequest {
  return {
    id: "w-1",
    sessionId: "s-1",
    missionRunId: "run-1",
    dueAt: new Date(NOW + 60_000).toISOString(),
    status: "pending",
    reason: null,
    payload: null,
    createdAt: new Date(NOW).toISOString(),
    consumedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    ...over,
  };
}

interface ScheduledOv2 {
  runId: string;
  sessionId: string;
  dueAt: Date;
  reason: string;
  failover: boolean;
}

interface Harness {
  deps: SelfHealDeps;
  paused_error: MissionRun[];
  paused_wake: MissionRun[];
  pending: Map<string, LoopWakeRequest | null>;
  scheduledOv2: ScheduledOv2[];
  enqueued: Parameters<SelfHealDeps["enqueueWake"]>[0][];
  cancelled: string[];
  finalized: string[];
  flattened: string[];
  counter: number;
  providerReady: boolean;
}

function harness(over: Partial<SelfHealDeps> = {}): Harness {
  const h: Harness = {
    paused_error: [],
    paused_wake: [],
    pending: new Map(),
    scheduledOv2: [],
    enqueued: [],
    cancelled: [],
    finalized: [],
    flattened: [],
    counter: 0,
    providerReady: true,
    deps: undefined as unknown as SelfHealDeps,
  };
  h.deps = {
    now: () => NOW,
    isProviderReady: () => h.providerReady,
    listRunsByStatus: async (status) =>
      status === "paused_error" ? h.paused_error : status === "paused_wake" ? h.paused_wake : [],
    getSessionPermission: async () => "full",
    // Default: $0 run-scoped spend, so the cost bound is transparent unless a
    // case overrides it (RECONCILIATION A).
    getRunCost: async () => 0,
    getPendingWake: async (sessionId) => h.pending.get(sessionId) ?? null,
    // Atomic OV2 schedule: mirrors the real insert-first / increment-if-won
    // helper — returns null when a wake is already pending for the session.
    scheduleErrorRetry: async (input) => {
      if ((h.pending.get(input.sessionId) ?? null) !== null) return null;
      h.scheduledOv2.push(input);
      const r = h.paused_error.find((x) => x.id === input.runId);
      const attempt = (r?.errorRetryCount ?? 0) + 1;
      return { attempt };
    },
    enqueueWake: async (input) => {
      h.enqueued.push(input);
      return wake({ id: `enq-${++h.counter}`, payload: input.payload as Record<string, unknown> });
    },
    cancelPendingWakes: async (sessionId) => {
      h.cancelled.push(sessionId);
      return 1;
    },
    finalizeStalledWake: async (runId) => {
      h.finalized.push(runId);
      return true;
    },
    flattenStalledWakePositions: async ({ runId }) => {
      h.flattened.push(runId);
    },
    ...over,
  };
  return h;
}

beforeEach(() => {
  delete process.env.AGENT_SELF_HEAL_ENABLED;
  delete process.env.AGENT_MODEL_FALLBACK;
  delete process.env.AGENT_MISSION_COST_CAP_USD;
});
afterEach(() => {
  delete process.env.AGENT_SELF_HEAL_ENABLED;
  delete process.env.AGENT_MODEL_FALLBACK;
  delete process.env.AGENT_MISSION_COST_CAP_USD;
});

// ── OV2 ─────────────────────────────────────────────────────────

describe("OV2 — provider-outage re-arm", () => {
  it("schedules a self-heal retry for a transient in-deadline run (boot re-arm)", async () => {
    const h = harness();
    h.paused_error = [run({ errorRetryCount: 0 })];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();

    expect(r.scheduled).toBe(1);
    expect(h.scheduledOv2).toHaveLength(1);
    const enq = h.scheduledOv2[0];
    expect(enq.runId).toBe("run-1");
    expect(enq.failover).toBe(false);
    // first rung = 1m
    expect(enq.dueAt.getTime()).toBe(NOW + 60_000);
  });

  it("keeps re-arming across ticks on a longer-than-fast-window outage, walking the backoff ladder", async () => {
    const h = harness();
    const wd = createSelfHealWatchdog(h.deps);

    // attempt at errorRetryCount 0,1,2 → rungs 1m,2m,5m
    for (const [count, rung] of [
      [0, 60_000],
      [1, 120_000],
      [2, 300_000],
    ] as const) {
      h.scheduledOv2 = [];
      h.pending.set("s-1", null); // prior wake consumed, run re-paused
      h.paused_error = [run({ errorRetryCount: count })];
      const r = await wd.tick();
      expect(r.scheduled).toBe(1);
      expect(h.scheduledOv2[0].dueAt.getTime()).toBe(NOW + rung);
    }
  });

  it("defers to a pending retry wake (no double-fire, spaces the ladder)", async () => {
    const h = harness();
    h.paused_error = [run()];
    h.pending.set("s-1", wake()); // a retry is already scheduled
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(0);
    expect(r.skipped).toBe(1);
    expect(h.scheduledOv2).toHaveLength(0);
  });

  it("fails over to the backup model past the threshold", async () => {
    process.env.AGENT_MODEL_FALLBACK = "gemini-2.5-flash";
    const h = harness();
    h.paused_error = [run({ errorRetryCount: SELF_HEAL_FAILOVER_THRESHOLD })];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(1);
    expect(h.scheduledOv2[0].failover).toBe(true);
  });

  it("does NOT set failover below the threshold", async () => {
    process.env.AGENT_MODEL_FALLBACK = "gemini-2.5-flash";
    const h = harness();
    h.paused_error = [run({ errorRetryCount: SELF_HEAL_FAILOVER_THRESHOLD - 1 })];
    const wd = createSelfHealWatchdog(h.deps);
    await wd.tick();
    expect(h.scheduledOv2[0].failover).toBe(false);
  });

  it("recovery CEASES at the deadline (past-deadline run is left for the reaper)", async () => {
    const h = harness();
    // started 2h ago, 60m box → deadline passed
    h.paused_error = [run({ startedAt: "2026-07-25T00:00:00.000Z" })];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(0);
    expect(h.scheduledOv2).toHaveLength(0);
  });

  // RECONCILIATION A — the self-heal ladder ceases at the COST cap too, not just
  // the deadline. An in-deadline run whose run-scoped spend is at/over its dollar
  // cap arms NO further wake (OV2 gives it up → the reaper is free to finalize).
  it("recovery CEASES at the cost cap (over-cap in-deadline run is left for the reaper)", async () => {
    process.env.AGENT_MISSION_COST_CAP_USD = "1"; // $1 cap
    const h = harness({ getRunCost: async () => 1.5 }); // already spent $1.50 ≥ cap
    h.paused_error = [run({ errorRetryCount: 0 })]; // transient, safe, in-deadline
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(0);
    expect(h.scheduledOv2).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it("keeps re-arming while UNDER the cost cap (cost gate is non-blocking)", async () => {
    process.env.AGENT_MISSION_COST_CAP_USD = "1";
    const h = harness({ getRunCost: async () => 0.4 }); // under cap
    h.paused_error = [run({ errorRetryCount: 0 })];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(1);
    expect(h.scheduledOv2).toHaveLength(1);
  });

  it("never schedules a NON-transient error (stays paused for a human)", async () => {
    const h = harness();
    h.paused_error = [run({ stopEvidenceJson: { classified: "permanent" } })];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(0);
    expect(h.scheduledOv2).toHaveLength(0);
  });

  it("never schedules across a half-completed irreversible action (unsafe stamp)", async () => {
    const h = harness();
    h.paused_error = [run({ autoRetryUnsafe: true })];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(0);
    expect(h.scheduledOv2).toHaveLength(0);
  });

  it("only recovers full-mode missions", async () => {
    const h = harness({ getSessionPermission: async () => "restricted" });
    h.paused_error = [run()];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(0);
  });

  it("stops at the absolute attempt ceiling", async () => {
    const h = harness();
    h.paused_error = [run({ errorRetryCount: MAX_SELF_HEAL_ATTEMPTS })];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.scheduled).toBe(0);
  });

  it("ignores a paused_error that is not a provider_error", async () => {
    const h = harness();
    h.paused_error = [run({ stopReason: "user_stop" })];
    const wd = createSelfHealWatchdog(h.deps);
    const r = await wd.tick();
    expect(r.scheduled).toBe(0);
  });
});

// ── Kill switch ─────────────────────────────────────────────────

describe("kill switch", () => {
  it("disabled → whole tick is a no-op (park-and-wait)", async () => {
    process.env.AGENT_SELF_HEAL_ENABLED = "false";
    const h = harness();
    h.paused_error = [run()];
    h.paused_wake = [run({ id: "run-2", status: "paused_wake" })];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r).toEqual({ scheduled: 0, wakeResumed: 0, finalized: 0, skipped: 0, errors: 0 });
    expect(h.scheduledOv2).toHaveLength(0);
    expect(h.enqueued).toHaveLength(0);
    expect(h.finalized).toHaveLength(0);
  });
});

// ── Provider gate ───────────────────────────────────────────────

describe("provider readiness gate", () => {
  it("not ready (vault locked / key not injected) → no-op, never re-arms or finalizes", async () => {
    const staleCheckpoint = new Date(NOW - WAKE_STALL_MARGIN_MS - 60_000).toISOString();
    const h = harness();
    h.providerReady = false;
    h.paused_error = [run()];
    h.paused_wake = [
      run({ id: "run-2", status: "paused_wake", lastCheckpointAt: staleCheckpoint }),
    ];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r).toEqual({ scheduled: 0, wakeResumed: 0, finalized: 0, skipped: 0, errors: 0 });
    expect(h.scheduledOv2).toHaveLength(0);
    expect(h.enqueued).toHaveLength(0);
    expect(h.finalized).toHaveLength(0);
  });
});

// ── Fail-soft ───────────────────────────────────────────────────

describe("fail-soft", () => {
  it("a per-run dep failure is counted, not thrown, and other runs still process", async () => {
    const boom = run({ id: "boom", sessionId: "s-boom" });
    const ok = run({ id: "ok", sessionId: "s-ok" });
    const h = harness({
      scheduleErrorRetry: async (input) => {
        if (input.sessionId === "s-boom") throw new Error("db down");
        return { attempt: 1 };
      },
    });
    h.paused_error = [boom, ok];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.errors).toBe(1);
    expect(r.scheduled).toBe(1); // the healthy run still got scheduled
  });

  it("a whole-sweep failure never throws out of tick()", async () => {
    const h = harness({
      listRunsByStatus: async () => {
        throw new Error("list failed");
      },
    });
    const wd = createSelfHealWatchdog(h.deps);
    const r = await wd.tick();
    expect(r.errors).toBeGreaterThanOrEqual(1);
  });
});

// ── OV3 ─────────────────────────────────────────────────────────

describe("OV3 — paused_wake stall", () => {
  const staleCheckpoint = new Date(NOW - WAKE_STALL_MARGIN_MS - 60_000).toISOString();

  it("re-arms an overdue paused_wake with a fresh due-now wake", async () => {
    const h = harness();
    h.paused_wake = [
      run({ id: "run-w", status: "paused_wake", lastCheckpointAt: staleCheckpoint }),
    ];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.wakeResumed).toBe(1);
    expect(h.cancelled).toContain("s-1");
    expect(h.enqueued).toHaveLength(1);
    expect(h.enqueued[0].dueAt.getTime()).toBe(NOW);
  });

  it("leaves a freshly-parked paused_wake alone (within the margin)", async () => {
    const h = harness();
    h.paused_wake = [
      run({
        id: "run-w",
        status: "paused_wake",
        lastCheckpointAt: new Date(NOW - 10_000).toISOString(),
      }),
    ];
    const wd = createSelfHealWatchdog(h.deps);

    const r = await wd.tick();
    expect(r.wakeResumed).toBe(0);
    expect(h.enqueued).toHaveLength(0);
  });

  it("finalizes cleanly after the bounded attempts with no progress", async () => {
    const h = harness();
    const wd = createSelfHealWatchdog(h.deps);
    const stalled = () =>
      run({
        id: "run-w",
        status: "paused_wake",
        iterationCount: 3, // never advances
        lastCheckpointAt: staleCheckpoint,
      });

    // MAX resume attempts, each a fresh tick (pending cleared each time)
    for (let i = 0; i < MAX_WAKE_STALL_ATTEMPTS; i++) {
      h.paused_wake = [stalled()];
      h.pending.set("s-1", null);
      const r = await wd.tick();
      expect(r.wakeResumed).toBe(1);
    }
    // next tick: budget exhausted with no iteration progress → finalize
    h.paused_wake = [stalled()];
    h.pending.set("s-1", null);
    const rFinal = await wd.tick();
    expect(rFinal.finalized).toBe(1);
    expect(h.finalized).toEqual(["run-w"]);
  });

  it("iteration progress resets the bounded budget", async () => {
    const h = harness();
    const wd = createSelfHealWatchdog(h.deps);

    for (let i = 0; i < MAX_WAKE_STALL_ATTEMPTS; i++) {
      h.paused_wake = [
        run({ id: "run-w", status: "paused_wake", iterationCount: 3, lastCheckpointAt: staleCheckpoint }),
      ];
      h.pending.set("s-1", null);
      await wd.tick();
    }
    // progressed since last attempt → budget resets, so this resumes (not finalizes)
    h.paused_wake = [
      run({ id: "run-w", status: "paused_wake", iterationCount: 9, lastCheckpointAt: staleCheckpoint }),
    ];
    h.pending.set("s-1", null);
    const r = await wd.tick();
    expect(r.finalized).toBe(0);
    expect(r.wakeResumed).toBe(1);
  });
});
