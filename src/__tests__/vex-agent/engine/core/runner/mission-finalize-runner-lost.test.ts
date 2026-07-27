/**
 * Mission-finalize — `runner_lost` branch (the WEDGED / orphaned run reclaim,
 * also used by a leaseless force-stop).
 *
 * Pins:
 *   - the flip is GUARDED (`markStoppedIfRunning`, `WHERE status='running'`):
 *     when it WINS, the run goes terminal `stopped`, the parent mission goes
 *     `cancelled`, and the `mission_results` ledger is closed with
 *     `outcome='stopped'` + `stopReason='runner_lost'`,
 *   - when the guard LOSES (already terminal — a second reconcile pass), the
 *     branch is a no-op: it never re-closes the ledger or re-flips the mission.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMarkStoppedIfRunning = vi.fn();
const mockUpdateStatus = vi.fn();
const mockGetRun = vi.fn().mockResolvedValue(null);
const mockSetMissionStatus = vi.fn();
const mockClearApprovedAt = vi.fn();
const mockCaptureMissionFinal = vi.fn().mockResolvedValue(undefined);
const mockGetLease = vi.fn().mockResolvedValue(null);

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  setStatus: (...a: unknown[]) => mockSetMissionStatus(...a),
  clearApprovedAt: (...a: unknown[]) => mockClearApprovedAt(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  markStoppedIfRunning: (...a: unknown[]) => mockMarkStoppedIfRunning(...a),
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  getRun: (...a: unknown[]) => mockGetRun(...a),
}));

vi.mock("@vex-agent/db/repos/runner-leases.js", () => ({
  getLease: (...a: unknown[]) => mockGetLease(...a),
}));

vi.mock("../../../../../vex-agent/engine/mission/mission-results-capture.js", () => ({
  captureMissionFinal: (...a: unknown[]) => mockCaptureMissionFinal(...a),
  captureMissionStart: vi.fn(),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/abort.js", () => ({
  consumeMissionRunAbortIntent: vi.fn().mockReturnValue(null),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/runtime-continuation.js", () => ({
  isContinuableRuntimeStop: vi.fn().mockReturnValue(false),
  scheduleRuntimeContinuation: vi.fn(),
}));

import { finalizeMissionRunStatus } from "../../../../../vex-agent/engine/core/runner/mission-finalize.js";

describe("finalizeMissionRunStatus — runner_lost", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetRun.mockResolvedValue(null);
    mockGetLease.mockResolvedValue(null);
  });

  it("wins the guarded claim → run stopped, mission cancelled, ledger closed", async () => {
    mockMarkStoppedIfRunning.mockResolvedValue(true);

    const status = await finalizeMissionRunStatus(
      "mission-1",
      "run-1",
      "sess-1",
      "runner_lost",
      { summary: "interrupted" },
    );

    expect(status).toBe("cancelled");
    expect(mockMarkStoppedIfRunning).toHaveBeenCalledWith(
      "run-1",
      "runner_lost",
      { summary: "interrupted" },
    );
    expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-1", "cancelled");
    expect(mockCaptureMissionFinal).toHaveBeenCalledTimes(1);
    const arg = mockCaptureMissionFinal.mock.calls[0]![0] as {
      outcome: string;
      stopReason: string;
    };
    expect(arg.outcome).toBe("stopped");
    expect(arg.stopReason).toBe("runner_lost");
    // Never uses the unguarded updateStatus for this branch.
    expect(mockUpdateStatus).not.toHaveBeenCalled();
  });

  it("loses the guarded claim (already terminal) → no ledger close, no mission flip", async () => {
    mockMarkStoppedIfRunning.mockResolvedValue(false);

    const status = await finalizeMissionRunStatus(
      "mission-1",
      "run-1",
      "sess-1",
      "runner_lost",
    );

    expect(status).toBe("cancelled");
    expect(mockSetMissionStatus).not.toHaveBeenCalled();
    expect(mockCaptureMissionFinal).not.toHaveBeenCalled();
  });
});
