/**
 * Deadline watchdog — the agent-INDEPENDENT enforcement path.
 *
 * The turn-loop boundary check (turn-loop.ts) only fires while the loop is
 * actively iterating. A run that is PARKED (`paused_error` / `paused_wake` /
 * `paused_user` / `paused_approval` / `paused_plan_acceptance`) never reaches
 * that boundary, so before this watchdog a mission could sit past its hard
 * deadline indefinitely (observed live: a 5-minute box ran 1h20m). This sweep
 * runs on a wall-clock timer and stops any active-or-parked run whose frozen
 * deadline has passed — regardless of parked state — with `deadline_reached`.
 *
 * Pure `sweepMissionDeadlines(now, deps)` with injected deps so we never touch
 * the real DB (matches the wake executor's test style).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sweepMissionDeadlines,
  type DeadlineWatchdogDeps,
} from "@vex-agent/engine/wake/deadline-watchdog.js";
import { PAUSED_RUN_STATUSES } from "@vex-agent/engine/types.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";
import type { MissionRunStatus } from "@vex-agent/engine/types.js";

const NOW = new Date("2026-07-12T20:00:00.000Z");
const PAST = "2026-07-12T18:00:00.000Z"; // started 2h ago
const RECENT = "2026-07-12T19:59:00.000Z"; // started 1m ago

function makeRun(overrides: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "run-1",
    missionId: "mission-1",
    sessionId: "sess-1",
    status: "paused_error",
    startedAt: PAST,
    endedAt: null,
    lastCheckpointAt: null,
    stopReason: "provider_error",
    stopSummary: null,
    stopEvidenceJson: null,
    iterationCount: 3,
    contractSnapshotJson: null,
    recoveredFromRunId: null,
    errorRetryCount: 0,
    autoRetryUnsafe: false,
    ...overrides,
  };
}

/** Deadline = started_at + 5 minutes (a 5-min box). */
function fiveMinBox(run: MissionRun): number | null {
  const startMs = Date.parse(run.startedAt);
  return Number.isNaN(startMs) ? null : startMs + 5 * 60_000;
}

function makeDeps(overrides: Partial<DeadlineWatchdogDeps> = {}): DeadlineWatchdogDeps {
  return {
    listCandidateRuns: vi.fn().mockResolvedValue([]),
    resolveDeadlineMs: vi.fn(fiveMinBox),
    getLease: vi.fn().mockResolvedValue(null),
    casStopPastDeadline: vi
      .fn<DeadlineWatchdogDeps["casStopPastDeadline"]>()
      // Default: claim succeeds, returning the previous (parked) status.
      .mockImplementation(async (_runId, fromStatuses) => fromStatuses[0]),
    rejectPendingApprovals: vi.fn().mockResolvedValue(0),
    setMissionFailed: vi.fn().mockResolvedValue(undefined),
    captureTimedOut: vi.fn().mockResolvedValue(undefined),
    emitControlState: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("sweepMissionDeadlines", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([...PAUSED_RUN_STATUSES] as MissionRunStatus[])(
    "stops a %s run that is past its deadline (deadline_reached)",
    async (status) => {
      const run = makeRun({ status });
      const deps = makeDeps({
        listCandidateRuns: vi.fn().mockResolvedValue([run]),
        // Real repo returns the actual locked status of the claimed row.
        casStopPastDeadline: vi.fn().mockResolvedValue(status),
      });

      const outcomes = await sweepMissionDeadlines(NOW, deps);

      expect(outcomes).toEqual([
        { kind: "stopped", runId: "run-1", previousStatus: status },
      ]);
      // Claimed from the PAUSED set (atomic, idempotent) with deadline_reached.
      expect(deps.casStopPastDeadline).toHaveBeenCalledTimes(1);
      const [claimedId, fromStatuses, payload] = (
        deps.casStopPastDeadline as ReturnType<typeof vi.fn>
      ).mock.calls[0];
      expect(claimedId).toBe("run-1");
      expect([...fromStatuses].sort()).toEqual([...PAUSED_RUN_STATUSES].sort());
      expect(payload.stopReason).toBe("deadline_reached");
      // Position CLOSING is deferred — the run is flagged, never auto-sold.
      expect(payload.evidence.enforcedWhileParked).toBe(true);
      expect(payload.evidence.positionCloseDeferred).toBe(true);
      // Pending approvals for the session are resolved so a swept
      // paused_approval run can't be resumed back out of its terminal state.
      expect(deps.rejectPendingApprovals).toHaveBeenCalledWith("sess-1");
      // Same terminal side-effects as the loop-boundary finalize path.
      expect(deps.setMissionFailed).toHaveBeenCalledWith("mission-1");
      expect(deps.captureTimedOut).toHaveBeenCalledWith({
        missionId: "mission-1",
        runId: "run-1",
        sessionId: "sess-1",
      });
      expect(deps.emitControlState).toHaveBeenCalledWith("sess-1", "run-1");
    },
  );

  it("is idempotent: a lost CAS (already stopped/resumed) does NO double side-effects", async () => {
    const run = makeRun({ status: "paused_wake" });
    const deps = makeDeps({
      listCandidateRuns: vi.fn().mockResolvedValue([run]),
      casStopPastDeadline: vi.fn().mockResolvedValue(null), // another path won
    });

    const outcomes = await sweepMissionDeadlines(NOW, deps);

    expect(outcomes).toEqual([{ kind: "skipped_already_terminal", runId: "run-1" }]);
    expect(deps.rejectPendingApprovals).not.toHaveBeenCalled();
    expect(deps.setMissionFailed).not.toHaveBeenCalled();
    expect(deps.captureTimedOut).not.toHaveBeenCalled();
    expect(deps.emitControlState).not.toHaveBeenCalled();
  });

  it("resolves the pending approval when it stops a paused_approval run (no resume-back-to-error)", async () => {
    const run = makeRun({ status: "paused_approval" });
    const rejectPendingApprovals = vi.fn().mockResolvedValue(1);
    const deps = makeDeps({
      listCandidateRuns: vi.fn().mockResolvedValue([run]),
      casStopPastDeadline: vi.fn().mockResolvedValue("paused_approval"),
      rejectPendingApprovals,
    });

    const outcomes = await sweepMissionDeadlines(NOW, deps);

    expect(outcomes).toEqual([
      { kind: "stopped", runId: "run-1", previousStatus: "paused_approval" },
    ]);
    expect(rejectPendingApprovals).toHaveBeenCalledWith("sess-1");
  });

  it("leaves a not-yet-due parked run alone (no stop)", async () => {
    const run = makeRun({ status: "paused_error", startedAt: RECENT });
    const deps = makeDeps({ listCandidateRuns: vi.fn().mockResolvedValue([run]) });

    const outcomes = await sweepMissionDeadlines(NOW, deps);

    expect(outcomes).toEqual([{ kind: "skipped_not_due", runId: "run-1" }]);
    expect(deps.casStopPastDeadline).not.toHaveBeenCalled();
  });

  it("skips a run with no resolvable deadline (fail-open)", async () => {
    const run = makeRun({ startedAt: "not-a-date" });
    const deps = makeDeps({
      listCandidateRuns: vi.fn().mockResolvedValue([run]),
      resolveDeadlineMs: vi.fn().mockReturnValue(null),
    });

    const outcomes = await sweepMissionDeadlines(NOW, deps);

    expect(outcomes).toEqual([{ kind: "skipped_no_deadline", runId: "run-1" }]);
    expect(deps.casStopPastDeadline).not.toHaveBeenCalled();
  });

  it("does NOT stop a running run whose lease is still alive (live loop self-stops)", async () => {
    const run = makeRun({ status: "running" });
    const deps = makeDeps({
      listCandidateRuns: vi.fn().mockResolvedValue([run]),
      getLease: vi
        .fn()
        .mockResolvedValue({ expiresAt: new Date(NOW.getTime() + 30_000) }),
    });

    const outcomes = await sweepMissionDeadlines(NOW, deps);

    expect(outcomes).toEqual([{ kind: "skipped_live_lease", runId: "run-1" }]);
    expect(deps.casStopPastDeadline).not.toHaveBeenCalled();
  });

  it("stops a past-deadline running run whose lease is DEAD (ghost run)", async () => {
    const run = makeRun({ status: "running" });
    const deps = makeDeps({
      listCandidateRuns: vi.fn().mockResolvedValue([run]),
      getLease: vi
        .fn()
        .mockResolvedValue({ expiresAt: new Date(NOW.getTime() - 1_000) }),
    });

    const outcomes = await sweepMissionDeadlines(NOW, deps);

    expect(outcomes).toEqual([
      { kind: "stopped", runId: "run-1", previousStatus: "running" },
    ]);
    // Running ghost is claimed from the ["running"] set only.
    const [, fromStatuses] = (
      deps.casStopPastDeadline as ReturnType<typeof vi.fn>
    ).mock.calls[0];
    expect([...fromStatuses]).toEqual(["running"]);
  });

  it("stops a past-deadline running run with NO lease row (ghost run)", async () => {
    const run = makeRun({ status: "running" });
    const deps = makeDeps({
      listCandidateRuns: vi.fn().mockResolvedValue([run]),
      getLease: vi.fn().mockResolvedValue(null),
    });

    const outcomes = await sweepMissionDeadlines(NOW, deps);

    expect(outcomes[0]).toMatchObject({ kind: "stopped", runId: "run-1" });
  });

  it("isolates a per-run failure so the rest of the batch still gets swept", async () => {
    const bad = makeRun({ id: "run-bad", status: "paused_error" });
    const good = makeRun({ id: "run-good", status: "paused_wake" });
    const deps = makeDeps({
      listCandidateRuns: vi.fn().mockResolvedValue([bad, good]),
      casStopPastDeadline: vi
        .fn()
        .mockImplementation(async (runId: string) => {
          if (runId === "run-bad") throw new Error("db blip");
          return "paused_wake"; // the locked status of run-good
        }),
    });

    const outcomes = await sweepMissionDeadlines(NOW, deps);

    expect(outcomes).toContainEqual({ kind: "error", runId: "run-bad", message: "db blip" });
    expect(outcomes).toContainEqual({
      kind: "stopped",
      runId: "run-good",
      previousStatus: "paused_wake",
    });
  });
});
