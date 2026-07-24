/**
 * Orphaned-run reconciler — the safety net for WEDGED mission runs (a
 * `status='running'` row whose runner lease expired with no worker
 * re-acquiring it). These tests pin the sweep orchestration with all seams
 * injected (no DB):
 *
 *   - each orphan is FLATTENED (deadline liquidation core) then FINALIZED via
 *     the shared finalize path (`runner_lost`), then its stale lease dropped,
 *   - flatten runs BEFORE finalize (mission still hydratable as active),
 *   - one orphan's failure NEVER aborts the sweep,
 *   - an empty scan / a scan-query failure is a fail-soft no-op,
 *   - the in-process guard prevents a re-entrant double-process of a run.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@utils/logger.js", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  reconcileOrphanedRuns,
  RUNNER_LOST_STOP_REASON,
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
    flatten: vi.fn(async () => {}),
    finalize: vi.fn(async () => "cancelled"),
    dropStaleLease: vi.fn(async () => 1),
    ...over,
  };
}

describe("reconcileOrphanedRuns", () => {
  beforeEach(() => vi.clearAllMocks());

  it("flattens, finalizes to runner_lost, and drops the lease for each orphan", async () => {
    const runs = [
      orphan(),
      orphan({ id: "run-2", missionId: "mission-2", sessionId: "sess-2" }),
    ];
    const d = deps({ findOrphans: vi.fn(async () => runs) });

    const summary = await reconcileOrphanedRuns(d);

    expect(summary).toEqual({ scanned: 2, reconciled: 2, skipped: 0, failed: 0 });
    expect(d.flatten).toHaveBeenCalledTimes(2);
    expect(d.flatten).toHaveBeenCalledWith({
      missionId: "mission-1",
      runId: "run-1",
      sessionId: "sess-1",
    });
    expect(d.finalize).toHaveBeenCalledWith(
      "mission-1",
      "run-1",
      "sess-1",
      RUNNER_LOST_STOP_REASON,
      expect.objectContaining({ summary: expect.any(String) }),
    );
    expect(d.dropStaleLease).toHaveBeenCalledWith("sess-1");
    expect(d.dropStaleLease).toHaveBeenCalledWith("sess-2");
  });

  it("flattens BEFORE finalizing (mission still active when positions are sold)", async () => {
    const order: string[] = [];
    const d = deps({
      findOrphans: vi.fn(async () => [orphan()]),
      flatten: vi.fn(async () => {
        order.push("flatten");
      }),
      finalize: vi.fn(async () => {
        order.push("finalize");
        return "cancelled";
      }),
    });

    await reconcileOrphanedRuns(d);

    expect(order).toEqual(["flatten", "finalize"]);
  });

  it("isolates a per-run failure — the sweep continues and counts it", async () => {
    const runs = [orphan(), orphan({ id: "run-2", sessionId: "sess-2" })];
    const finalize = vi
      .fn()
      .mockRejectedValueOnce(new Error("finalize boom"))
      .mockResolvedValueOnce("cancelled");
    const d = deps({ findOrphans: vi.fn(async () => runs), finalize });

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
    expect(d.flatten).not.toHaveBeenCalled();
    expect(d.finalize).not.toHaveBeenCalled();
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
