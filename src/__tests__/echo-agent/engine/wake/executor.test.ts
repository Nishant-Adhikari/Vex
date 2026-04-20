/**
 * PR-7 — wake executor unit tests. Exercises the pure `tick` function with
 * injected `WakeDeps` so we never load the DB client. Covers:
 *   - mission_run claims that resume (banner + status flip + resume call),
 *   - skip-stale-status re-check (preemption won the race),
 *   - skip-missing-mission-run guard,
 *   - full_autonomous kind drift,
 *   - error isolation (one row's failure doesn't poison the batch).
 */

import { describe, it, expect, vi } from "vitest";

import { tick, type WakeDeps } from "../../../../echo-agent/engine/wake/executor.js";
import type { LoopWakeRequest } from "../../../../echo-agent/db/repos/loop-wake.js";
import type { MissionRun } from "../../../../echo-agent/db/repos/mission-runs.js";

function makeWake(overrides: Partial<LoopWakeRequest> = {}): LoopWakeRequest {
  return {
    id: "wake-1",
    sessionId: "sess-1",
    missionRunId: "run-1",
    kind: "mission_run",
    dueAt: "2026-04-20T12:00:00.000Z",
    status: "consumed",
    reason: "continue monitoring",
    payload: null,
    createdAt: "2026-04-20T11:59:00.000Z",
    consumedAt: "2026-04-20T12:00:01.000Z",
    cancelledAt: null,
    cancelledReason: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "run-1",
    missionId: "mission-1",
    sessionId: "sess-1",
    status: "paused_wake",
    loopMode: "restricted",
    startedAt: "2026-04-20T10:00:00.000Z",
    endedAt: null,
    lastCheckpointAt: null,
    stopReason: "waiting_for_wake",
    stopSummary: null,
    stopEvidenceJson: null,
    iterationCount: 3,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<WakeDeps> = {}): WakeDeps {
  return {
    claimDue: vi.fn().mockResolvedValue([]),
    getMissionRun: vi.fn().mockResolvedValue(null),
    updateMissionRunStatus: vi.fn().mockResolvedValue(undefined),
    getSessionKind: vi.fn().mockResolvedValue("chat"),
    injectWakeBanner: vi.fn().mockResolvedValue(undefined),
    resumeMissionRun: vi.fn().mockResolvedValue(undefined),
    resumeFullAutonomousSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("wake.executor.tick", () => {
  it("resumes a paused_wake mission run — banner, status flip, resume", async () => {
    const wake = makeWake();
    const run = makeRun();
    const deps = makeDeps({
      claimDue: vi.fn().mockResolvedValue([wake]),
      getMissionRun: vi.fn().mockResolvedValue(run),
    });

    const results = await tick(new Date("2026-04-20T12:00:01.000Z"), 10, deps);

    expect(results).toHaveLength(1);
    expect(results[0]!.outcome).toEqual({ kind: "resumed", runId: "run-1" });
    expect(deps.injectWakeBanner).toHaveBeenCalledWith(
      "sess-1",
      "continue monitoring",
      "2026-04-20T12:00:00.000Z",
    );
    expect(deps.updateMissionRunStatus).toHaveBeenCalledWith("run-1", "running");
    expect(deps.resumeMissionRun).toHaveBeenCalledWith("run-1");
  });

  it("skips when the run is no longer paused_wake (user preempt won the race)", async () => {
    const deps = makeDeps({
      claimDue: vi.fn().mockResolvedValue([makeWake()]),
      getMissionRun: vi.fn().mockResolvedValue(makeRun({ status: "running" })),
    });

    const results = await tick(new Date(), 10, deps);

    expect(results[0]!.outcome).toEqual({
      kind: "skipped_stale_status",
      currentStatus: "running",
    });
    expect(deps.injectWakeBanner).not.toHaveBeenCalled();
    expect(deps.updateMissionRunStatus).not.toHaveBeenCalled();
    expect(deps.resumeMissionRun).not.toHaveBeenCalled();
  });

  it("skips when the mission run row has been deleted between claim and resume", async () => {
    const deps = makeDeps({
      claimDue: vi.fn().mockResolvedValue([makeWake()]),
      getMissionRun: vi.fn().mockResolvedValue(null),
    });

    const results = await tick(new Date(), 10, deps);

    expect(results[0]!.outcome).toEqual({ kind: "skipped_mission_run_missing" });
    expect(deps.resumeMissionRun).not.toHaveBeenCalled();
  });

  it("skips when a mission_run wake is missing its run id", async () => {
    const deps = makeDeps({
      claimDue: vi.fn().mockResolvedValue([makeWake({ missionRunId: null })]),
    });

    const results = await tick(new Date(), 10, deps);

    expect(results[0]!.outcome).toEqual({ kind: "skipped_mission_run_missing" });
    expect(deps.getMissionRun).not.toHaveBeenCalled();
  });

  it("routes full_autonomous wakes to resumeFullAutonomousSession", async () => {
    const wake = makeWake({ kind: "full_autonomous", missionRunId: null });
    const deps = makeDeps({
      claimDue: vi.fn().mockResolvedValue([wake]),
      getSessionKind: vi.fn().mockResolvedValue("full_autonomous"),
    });

    const results = await tick(new Date(), 10, deps);

    expect(results[0]!.outcome).toEqual({ kind: "resumed", runId: null });
    expect(deps.resumeFullAutonomousSession).toHaveBeenCalledWith("sess-1");
    expect(deps.resumeMissionRun).not.toHaveBeenCalled();
  });

  it("skips a full_autonomous wake when the session kind has drifted", async () => {
    const wake = makeWake({ kind: "full_autonomous", missionRunId: null });
    const deps = makeDeps({
      claimDue: vi.fn().mockResolvedValue([wake]),
      getSessionKind: vi.fn().mockResolvedValue("chat"),
    });

    const results = await tick(new Date(), 10, deps);

    expect(results[0]!.outcome).toEqual({
      kind: "skipped_session_kind_mismatch",
      currentKind: "chat",
    });
    expect(deps.resumeFullAutonomousSession).not.toHaveBeenCalled();
  });

  it("reports error outcome without poisoning the rest of the batch", async () => {
    const wakeA = makeWake({ id: "wake-a", missionRunId: "run-a" });
    const wakeB = makeWake({ id: "wake-b", missionRunId: "run-b" });
    const deps = makeDeps({
      claimDue: vi.fn().mockResolvedValue([wakeA, wakeB]),
      getMissionRun: vi.fn().mockImplementation((runId: string) => {
        if (runId === "run-a") throw new Error("db exploded");
        return Promise.resolve(makeRun({ id: "run-b" }));
      }),
    });

    const results = await tick(new Date(), 10, deps);

    expect(results).toHaveLength(2);
    expect(results[0]!.outcome).toEqual({ kind: "error", message: "db exploded" });
    expect(results[1]!.outcome).toEqual({ kind: "resumed", runId: "run-b" });
  });

  it("returns an empty array when claimDue yields no rows", async () => {
    const deps = makeDeps();
    const results = await tick(new Date(), 10, deps);
    expect(results).toEqual([]);
    expect(deps.injectWakeBanner).not.toHaveBeenCalled();
  });
});
