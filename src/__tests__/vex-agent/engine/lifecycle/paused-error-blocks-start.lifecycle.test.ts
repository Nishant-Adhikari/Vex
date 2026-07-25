/**
 * LIFECYCLE GUARD — a lingering `paused_error` run and the abandoned-error
 * REAPER that unwedges new mission starts (CONFIRMED PROD BUG, BUG C — FIXED).
 *
 * Production incident (companion to the expired-lease bug): a `paused_error`
 * run (provider_error) lingered with `ended_at=NULL` and 0 open positions. Such
 * a run is still "active" to `getActiveRunBySession` — BY DESIGN, so `/retry`
 * can find it — which means `prepareMissionStart` returns `session_has_active_run`
 * and REFUSES every new mission start on that session. That gate is CORRECT: it
 * protects a genuinely-recoverable run from being started over. The bug was the
 * ABSENCE of any reaper to resolve a run that is NOT recoverable (no live lease,
 * no open positions), so a truly-abandoned error permanently wedged the session.
 *
 * Two things this guard now pins:
 *   1. The `prepareMissionStart` gate still refuses while an active run is
 *      present (protective — unchanged), and proceeds when there is none.
 *   2. The BOOT reconcile pass REAPS an abandoned `paused_error` run (no live
 *      lease AND 0 open positions) to a terminal `failed(reaped_stale_error)`,
 *      but PRESERVES one that still holds a position (or whose position state is
 *      unknown) so the user can still Recover it.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MissionRun } from "@vex-agent/db/repos/mission-runs.js";

const getMission = vi.fn();
const getActiveRunBySession = vi.fn();

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...a: unknown[]) => getMission(...a),
}));
vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: (...a: unknown[]) => getActiveRunBySession(...a),
}));
vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { prepareMissionStart } = await import(
  "@vex-agent/engine/core/runner/mission-prepare.js"
);
const { reconcileOrphanedRuns } = await import(
  "@vex-agent/engine/core/runner/mission-reconcile.js"
);

beforeEach(() => {
  vi.clearAllMocks();
  getMission.mockResolvedValue({ id: "mission-1", rootSessionId: "sess-1" });
});

describe("prepareMissionStart — the active-run gate protects a recoverable run", () => {
  it("refuses a new start with session_has_active_run while a paused_error run is present", async () => {
    getActiveRunBySession.mockResolvedValue({
      id: "run-stuck",
      status: "paused_error",
      endedAt: null,
    });

    const outcome = await prepareMissionStart({ missionId: "mission-1" });

    // CORRECT protective behavior — the gate defers to the reaper (below) to
    // clear a run that is actually abandoned; it never starts over a run that
    // is still present (Recover must stay available).
    expect(outcome.outcome).toBe("session_has_active_run");
    if (outcome.outcome === "session_has_active_run") {
      expect(outcome.missionRunId).toBe("run-stuck");
      expect(outcome.runStatus).toBe("paused_error");
    }
  });

  it("proceeds past the active-run gate once no active run remains (post-reap)", async () => {
    getActiveRunBySession.mockResolvedValue(null);
    const outcome = await prepareMissionStart({ missionId: "mission-1" });
    // Past the active-run gate — it moves on to the provider step (unmocked
    // here), so the ONE thing we assert is that it did NOT short-circuit at the
    // active-run gate. This is the state the boot reaper produces.
    expect(outcome.outcome).not.toBe("session_has_active_run");
  });
});

// ── The boot reaper (BUG C fix) — driven with all seams injected (no DB). ──

function staleRun(over: Partial<MissionRun> = {}): MissionRun {
  return {
    id: "run-stuck",
    missionId: "mission-1",
    sessionId: "sess-1",
    status: "paused_error",
    startedAt: "2026-07-01T00:00:00.000Z",
    endedAt: null,
    lastCheckpointAt: null,
    stopReason: "provider_error",
    stopSummary: null,
    stopEvidenceJson: null,
    iterationCount: 2,
    contractSnapshotJson: null,
    recoveredFromRunId: null,
    errorRetryCount: 0,
    autoRetryUnsafe: false,
    ...over,
  } as MissionRun;
}

function reaperDeps(over: Record<string, unknown> = {}) {
  return {
    // Orphaned-RUNNING-run + lease-sweep seams — inert (this block guards the
    // paused_error reaper only).
    findOrphans: vi.fn(async () => []),
    claim: vi.fn(async () => true),
    flatten: vi.fn(async () => {}),
    closeLedger: vi.fn(async () => {}),
    dropStaleLease: vi.fn(async () => 1),
    sweepExpiredLeases: vi.fn(async () => 0),
    // Paused_error reaper seams.
    findAbandonedPausedErrors: vi.fn(async () => [staleRun()]),
    countRunOpenPositions: vi.fn(async () => 0),
    reapStaleError: vi.fn(async () => true),
    closeReapedLedger: vi.fn(async () => {}),
    ...over,
  };
}

describe("reconcileOrphanedRuns — abandoned paused_error reaper (BUG C fixed)", () => {
  it("reaps an abandoned paused_error run (no live lease AND 0 open positions)", async () => {
    const deps = reaperDeps();
    const summary = await reconcileOrphanedRuns(deps);

    expect(deps.reapStaleError).toHaveBeenCalledWith(
      "run-stuck",
      expect.objectContaining({ summary: expect.any(String) }),
    );
    expect(deps.closeReapedLedger).toHaveBeenCalledWith(
      "mission-1",
      "run-stuck",
      "sess-1",
    );
    expect(summary.staleErrorsReaped).toBe(1);
  });

  it("does NOT reap a paused_error run that still holds an open position (preserved for Recover)", async () => {
    const deps = reaperDeps({ countRunOpenPositions: vi.fn(async () => 1) });
    const summary = await reconcileOrphanedRuns(deps);

    expect(deps.reapStaleError).not.toHaveBeenCalled();
    expect(deps.closeReapedLedger).not.toHaveBeenCalled();
    expect(summary.staleErrorsReaped).toBe(0);
  });

  it("does NOT reap when the open-position read fails (fail-closed — preserved)", async () => {
    const deps = reaperDeps({
      countRunOpenPositions: vi.fn(async () => {
        throw new Error("rpc down");
      }),
    });
    const summary = await reconcileOrphanedRuns(deps);

    expect(deps.reapStaleError).not.toHaveBeenCalled();
    expect(summary.staleErrorsReaped).toBe(0);
  });

  it("does NOT reap when the guarded claim is lost (recovered / live lease reappeared)", async () => {
    const deps = reaperDeps({ reapStaleError: vi.fn(async () => false) });
    const summary = await reconcileOrphanedRuns(deps);

    expect(deps.reapStaleError).toHaveBeenCalledOnce();
    expect(deps.closeReapedLedger).not.toHaveBeenCalled();
    expect(summary.staleErrorsReaped).toBe(0);
  });
});
