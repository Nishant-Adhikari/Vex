/**
 * Orphaned-run reconciler — the safety net for WEDGED mission runs (a
 * `status='running'` row whose runner lease expired with no worker
 * re-acquiring it). These tests pin the sweep orchestration with all seams
 * injected (no DB):
 *
 *   - each orphan is CLAIMED race-safely, then FLATTENED (deadline liquidation
 *     core), then the finalize tail closes the ledger, then the stale lease is
 *     dropped,
 *   - claim runs BEFORE flatten/close (nothing is touched unless we won the run
 *     against a concurrent resume),
 *   - a LOST claim (resumed / already terminal) skips flatten + close entirely,
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
    claim: vi.fn(async () => true),
    flatten: vi.fn(async () => {}),
    closeLedger: vi.fn(async () => {}),
    dropStaleLease: vi.fn(async () => 1),
    ...over,
  };
}

describe("reconcileOrphanedRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("claims, flattens, closes the ledger, and drops the lease for each orphan", async () => {
    const runs = [
      orphan(),
      orphan({ id: "run-2", missionId: "mission-2", sessionId: "sess-2" }),
    ];
    const d = deps({ findOrphans: vi.fn(async () => runs) });

    const summary = await reconcileOrphanedRuns(d);

    expect(summary).toEqual({ scanned: 2, reconciled: 2, skipped: 0, failed: 0 });
    expect(d.claim).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ summary: expect.any(String) }),
    );
    expect(d.flatten).toHaveBeenCalledTimes(2);
    expect(d.flatten).toHaveBeenCalledWith({
      missionId: "mission-1",
      runId: "run-1",
      sessionId: "sess-1",
    });
    expect(d.closeLedger).toHaveBeenCalledWith("mission-1", "run-1", "sess-1");
    expect(d.dropStaleLease).toHaveBeenCalledWith("sess-1");
    expect(d.dropStaleLease).toHaveBeenCalledWith("sess-2");
  });

  it("claims BEFORE flattening + closing (never touches a run it did not win)", async () => {
    const order: string[] = [];
    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      claim: vi.fn(async () => {
        order.push("claim");
        return true;
      }),
      flatten: vi.fn(async () => {
        order.push("flatten");
      }),
      closeLedger: vi.fn(async () => {
        order.push("close");
      }),
    });

    await reconcileOrphanedRuns(d);

    expect(order).toEqual(["claim", "flatten", "close"]);
  });

  it("skips flatten + close when the claim is lost (resumed / already terminal)", async () => {
    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      claim: vi.fn(async () => false),
    });

    const summary = await reconcileOrphanedRuns(d);

    expect(summary).toEqual({ scanned: 1, reconciled: 0, skipped: 1, failed: 0 });
    expect(d.flatten).not.toHaveBeenCalled();
    expect(d.closeLedger).not.toHaveBeenCalled();
    expect(d.dropStaleLease).not.toHaveBeenCalled();
  });

  it("isolates a per-run failure — the sweep continues and counts it", async () => {
    const runs = [orphan(), orphan({ id: "run-2", sessionId: "sess-2" })];
    const closeLedger = vi
      .fn()
      .mockRejectedValueOnce(new Error("close boom"))
      .mockResolvedValueOnce(undefined);
    const d = deps({ findOrphans: vi.fn(async () => runs), closeLedger });

    const summary = await reconcileOrphanedRuns(d);

    expect(summary.scanned).toBe(2);
    expect(summary.failed).toBe(1);
    expect(summary.reconciled).toBe(1);
    // Second run still processed despite the first throwing.
    expect(d.dropStaleLease).toHaveBeenCalledWith("sess-2");
  });

  it("is a fail-soft no-op when there are no orphans", async () => {
    const d = deps();
    const summary = await reconcileOrphanedRuns(d);
    expect(summary).toEqual({ scanned: 0, reconciled: 0, skipped: 0, failed: 0 });
    expect(d.claim).not.toHaveBeenCalled();
    expect(d.flatten).not.toHaveBeenCalled();
    expect(d.closeLedger).not.toHaveBeenCalled();
  });

  it("never throws when the selection query itself fails", async () => {
    const d = deps({
      findOrphans: vi.fn(async () => {
        throw new Error("db down");
      }),
    });
    const summary = await reconcileOrphanedRuns(d);
    expect(summary).toEqual({ scanned: 0, reconciled: 0, skipped: 0, failed: 0 });
  });
});
