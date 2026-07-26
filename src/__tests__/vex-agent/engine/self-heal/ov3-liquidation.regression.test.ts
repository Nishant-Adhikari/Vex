/**
 * OV3-NO-LIQUIDATION regression — pins the fix that ensures
 * `flattenStalledWakePositions` is called BEFORE `finalizeStalledWake` when
 * a paused_wake run exhausts its stall budget.
 *
 * Bug: the OV3 path was calling `finalizeStalledWake` without first calling
 * `flattenStalledWakePositions`, leaving all open positions permanently
 * stranded.
 *
 * Fix: `flattenStalledWakePositions` is now called first; these tests pin
 * that ordering contract and the fail-soft guarantee around it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSelfHealWatchdog, type SelfHealDeps } from "@vex-agent/engine/self-heal/watchdog.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";
import type { LoopWakeRequest } from "@vex-agent/db/repos/loop-wake.js";
import { MAX_WAKE_STALL_ATTEMPTS, WAKE_STALL_MARGIN_MS } from "@vex-agent/engine/self-heal/policy.js";

const NOW = Date.parse("2026-07-25T02:00:00.000Z");
const START = "2026-07-25T01:30:00.000Z"; // 30m ago; 60m box → in-deadline

function run(over: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "run-w",
    missionId: "m-1",
    sessionId: "s-1",
    status: "paused_wake",
    startedAt: START,
    endedAt: null,
    lastCheckpointAt: null,
    stopReason: null,
    stopSummary: null,
    stopEvidenceJson: null,
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
    missionRunId: "run-w",
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

/** Stale checkpoint (overdue by margin + 60s) so every paused_wake tick is treated as stalled. */
const staleCheckpoint = new Date(NOW - WAKE_STALL_MARGIN_MS - 60_000).toISOString();

function buildDeps(over: Partial<SelfHealDeps> = {}): SelfHealDeps {
  let wakeCounter = 0;
  return {
    now: () => NOW,
    isProviderReady: () => true,
    listRunsByStatus: async (status) =>
      status === "paused_wake"
        ? [run({ lastCheckpointAt: staleCheckpoint })]
        : [],
    getSessionPermission: async () => "full",
    getRunCost: async () => 0,
    getPendingWake: async () => null,
    scheduleErrorRetry: async () => null,
    enqueueWake: async (input) =>
      wake({ id: `enq-${++wakeCounter}`, payload: input.payload as Record<string, unknown> }),
    cancelPendingWakes: async () => 1,
    finalizeStalledWake: async () => true,
    flattenStalledWakePositions: async () => {},
    ...over,
  };
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

describe("OV3-NO-LIQUIDATION regression", () => {
  it("flattenStalledWakePositions is called BEFORE finalizeStalledWake when stall budget exhausted", async () => {
    const callOrder: string[] = [];
    const flattenFn = vi.fn().mockImplementation(async () => {
      callOrder.push("flatten");
    });
    const finalizeFn = vi.fn().mockImplementation(async () => {
      callOrder.push("finalize");
      return true;
    });

    const stalledRun = run({ iterationCount: 3, lastCheckpointAt: staleCheckpoint });
    let listCalls = 0;
    const deps = buildDeps({
      listRunsByStatus: async (status) => {
        if (status !== "paused_wake") return [];
        listCalls++;
        // Always return the same stalled run (no progress)
        return [stalledRun];
      },
      getPendingWake: async () => null,
      flattenStalledWakePositions: flattenFn,
      finalizeStalledWake: finalizeFn,
    });

    const wd = createSelfHealWatchdog(deps);

    // Drive MAX_WAKE_STALL_ATTEMPTS re-arm ticks (budget fills up)
    for (let i = 0; i < MAX_WAKE_STALL_ATTEMPTS; i++) {
      await wd.tick();
    }

    // One more tick with no progress → budget exhausted → flatten + finalize
    const rFinal = await wd.tick();

    expect(rFinal.finalized).toBe(1);
    expect(flattenFn).toHaveBeenCalledTimes(1);
    expect(finalizeFn).toHaveBeenCalledTimes(1);

    // The critical ordering assertion: flatten must come before finalize
    expect(callOrder).toEqual(expect.arrayContaining(["flatten", "finalize"]));
    const flattenIdx = callOrder.indexOf("flatten");
    const finalizeIdx = callOrder.indexOf("finalize");
    expect(flattenIdx).toBeLessThan(finalizeIdx);
  });

  it("flattenStalledWakePositions is NOT called on the re-arm path (below threshold)", async () => {
    const flattenFn = vi.fn();
    const finalizeFn = vi.fn().mockResolvedValue(true);

    const deps = buildDeps({
      flattenStalledWakePositions: flattenFn,
      finalizeStalledWake: finalizeFn,
    });

    const wd = createSelfHealWatchdog(deps);

    // Run fewer ticks than the budget allows — each is a re-arm, not a finalize
    const ticksBeforeExhaustion = Math.max(1, MAX_WAKE_STALL_ATTEMPTS - 1);
    for (let i = 0; i < ticksBeforeExhaustion; i++) {
      const r = await wd.tick();
      expect(r.wakeResumed).toBe(1);
      expect(r.finalized).toBe(0);
    }

    // flatten is never called on the re-arm path
    expect(flattenFn).not.toHaveBeenCalled();
    // finalize is never called below the threshold
    expect(finalizeFn).not.toHaveBeenCalled();
  });

  it("finalizeStalledWake is still called even if flattenStalledWakePositions throws (fail-soft)", async () => {
    const flattenFn = vi.fn().mockRejectedValue(new Error("flatten boom"));
    const finalizeFn = vi.fn().mockResolvedValue(true);

    const deps = buildDeps({
      flattenStalledWakePositions: flattenFn,
      finalizeStalledWake: finalizeFn,
    });

    const wd = createSelfHealWatchdog(deps);

    // Fill the stall budget
    for (let i = 0; i < MAX_WAKE_STALL_ATTEMPTS; i++) {
      await wd.tick();
    }

    // Exhausted tick — flatten throws, but finalize must still be called
    const rFinal = await wd.tick();

    // finalize was reached despite the flatten error
    expect(finalizeFn).toHaveBeenCalledTimes(1);
    // The run was either finalized (if watchdog handles the throw) or counted
    // as an error — but it must NOT be silently swallowed leaving finalize uncalled.
    // Accept either finalized=1 (robust handler) or errors=1 (catch-rethrow style),
    // but finalize must have been called.
    expect(rFinal.finalized + rFinal.errors).toBeGreaterThanOrEqual(1);
  });
});
