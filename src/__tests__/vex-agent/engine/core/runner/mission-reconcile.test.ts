/**
 * Orphaned-run reconciler — the safety net for WEDGED mission runs (a
 * `status='running'` row whose runner lease expired with no worker
 * re-acquiring it). These tests pin the sweep orchestration with all seams
 * injected (no DB):
 *
 *   - each orphan is PARKED race-safely into `paused_wake`, gets a diagnostic
 *     transcript event, and is handed off to the wake executor with an
 *     immediate wake request,
 *   - the recovery park runs BEFORE the wake handoff (nothing is touched unless
 *     we won the run against a concurrent resume),
 *   - a LOST park claim (resumed / already terminal) skips wake handoff,
 *   - one orphan's failure NEVER aborts the sweep,
 *   - an empty scan / a scan-query failure is a fail-soft no-op.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@utils/logger.js", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  reconcileOrphanedRuns,
  type ReconcileDeps,
} from "@vex-agent/engine/core/runner/mission-reconcile.js";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";

function orphan(over: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "run-1",
    missionId: "mission-1",
    sessionId: "sess-1",
    status: "running",
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: null,
    lastCheckpointAt: null,
    stopReason: null,
    stopSummary: null,
    stopEvidenceJson: null,
    iterationCount: 3,
    contractSnapshotJson: null,
    recoveredFromRunId: null,
    errorRetryCount: 0,
    autoRetryUnsafe: false,
    ...over,
  };
}

function deps(over: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    findOrphans: vi.fn(async () => [] as MissionRun[]),
    parkForRecovery: vi.fn(async () => true),
    appendDiagnostic: vi.fn(async () => {}),
    enqueueRecoveryWake: vi.fn(async () => {}),
    claim: vi.fn(async () => true),
    flatten: vi.fn(async () => {}),
    closeLedger: vi.fn(async () => {}),
    dropStaleLease: vi.fn(async () => 1),
    // BUG B / BUG C seams — stubbed inert here so this suite pins only the
    // orphaned-RUNNING-run orchestration (the lease sweep + paused_error reaper
    // have their own guards in expired-lease-and-reconcile.lifecycle.test.ts).
    sweepExpiredLeases: vi.fn(async () => 0),
    findAbandonedPausedErrors: vi.fn(async () => [] as MissionRun[]),
    countRunOpenPositions: vi.fn(async () => 0),
    reapStaleError: vi.fn(async () => true),
    closeReapedLedger: vi.fn(async () => {}),
    ...over,
  };
}

/** The zero-valued lease-sweep / reaper counters, for exact summary asserts. */
const ZERO_SELF_HEAL = { leasesSwept: 0, staleErrorsReaped: 0 };

describe("reconcileOrphanedRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("parks, emits a diagnostic, and enqueues immediate wake recovery for each orphan", async () => {
    const runs = [
      orphan(),
      orphan({ id: "run-2", missionId: "mission-2", sessionId: "sess-2" }),
    ];
    const d = deps({ findOrphans: vi.fn(async () => runs) });

    const summary = await reconcileOrphanedRuns(d);

    expect(summary).toEqual({ scanned: 2, reconciled: 2, skipped: 0, failed: 0, ...ZERO_SELF_HEAL });
    expect(d.parkForRecovery).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ summary: expect.any(String) }),
    );
    expect(d.appendDiagnostic).toHaveBeenCalledWith(
      "sess-1",
      "run-1",
      expect.stringContaining("runner_lease_lost"),
      expect.objectContaining({ detectedBy: "orphan_reconciler" }),
    );
    expect(d.enqueueRecoveryWake).toHaveBeenCalledWith({
      sessionId: "sess-1",
      runId: "run-1",
    });
    expect(d.enqueueRecoveryWake).toHaveBeenCalledWith({
      sessionId: "sess-2",
      runId: "run-2",
    });
  });

  it("parks BEFORE enqueueing recovery (never touches a run it did not win)", async () => {
    const order: string[] = [];
    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      parkForRecovery: vi.fn(async () => {
        order.push("park");
        return true;
      }),
      enqueueRecoveryWake: vi.fn(async () => {
        order.push("wake");
      }),
    });

    await reconcileOrphanedRuns(d);

    expect(order).toEqual(["park", "wake"]);
  });

  it("skips wake handoff when the recovery park is lost (resumed / already terminal)", async () => {
    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      parkForRecovery: vi.fn(async () => false),
    });

    const summary = await reconcileOrphanedRuns(d);

    expect(summary).toEqual({ scanned: 1, reconciled: 0, skipped: 1, failed: 0, ...ZERO_SELF_HEAL });
    expect(d.enqueueRecoveryWake).not.toHaveBeenCalled();
  });

  it("isolates a per-run failure — the sweep continues and counts it", async () => {
    const runs = [orphan(), orphan({ id: "run-2", sessionId: "sess-2" })];
    const enqueueRecoveryWake = vi
      .fn()
      .mockRejectedValueOnce(new Error("wake boom"))
      .mockResolvedValueOnce(undefined);
    const d = deps({ findOrphans: vi.fn(async () => runs), enqueueRecoveryWake });

    const summary = await reconcileOrphanedRuns(d);

    expect(summary.scanned).toBe(2);
    expect(summary.failed).toBe(0);
    expect(summary.reconciled).toBe(2);
    // Second run still processed despite the first throwing.
    expect(d.enqueueRecoveryWake).toHaveBeenCalledWith({
      sessionId: "sess-2",
      runId: "run-2",
    });
  });

  it("is a fail-soft no-op when there are no orphans", async () => {
    const d = deps();
    const summary = await reconcileOrphanedRuns(d);
    expect(summary).toEqual({ scanned: 0, reconciled: 0, skipped: 0, failed: 0, ...ZERO_SELF_HEAL });
    expect(d.parkForRecovery).not.toHaveBeenCalled();
    expect(d.enqueueRecoveryWake).not.toHaveBeenCalled();
  });

  it("never throws when the selection query itself fails", async () => {
    const d = deps({
      findOrphans: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const summary = await reconcileOrphanedRuns(d);
    expect(summary).toEqual({ scanned: 0, reconciled: 0, skipped: 0, failed: 0, ...ZERO_SELF_HEAL });
  });
});
