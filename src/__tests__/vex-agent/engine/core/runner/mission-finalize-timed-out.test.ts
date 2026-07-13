/**
 * Mission-finalize — a run stopped by the hard-deadline enforcer
 * (`deadline_reached`) is a TIME-BOX end, not a failure. It must land in the
 * mission-results ledger with `outcome = "timed_out"` so the results card /
 * History / session panel read "TIMED OUT" instead of the alarming "FAILED"
 * (the mislabel a live Mission #2 showed after it merely ran out its hour).
 *
 * The engine run-status stays a terminal value (deadline_reached is a business
 * stop → shouldTerminateRun); this test pins the user-facing LEDGER outcome,
 * which is the surface the operator reviews.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockMissionRunsUpdateStatus = vi.fn();
const mockMissionRunsGetRun = vi.fn().mockResolvedValue(null);
const mockMissionsSetStatus = vi.fn();
const mockMissionsClearApprovedAt = vi.fn();
const mockConsumeAbortIntent = vi.fn().mockReturnValue(null);
const mockIsContinuableRuntimeStop = vi.fn().mockReturnValue(false);
const mockCaptureMissionFinal = vi.fn().mockResolvedValue(undefined);

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  setStatus: (...a: unknown[]) => mockMissionsSetStatus(...a),
  clearApprovedAt: (...a: unknown[]) => mockMissionsClearApprovedAt(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  updateStatus: (...a: unknown[]) => mockMissionRunsUpdateStatus(...a),
  getRun: (...a: unknown[]) => mockMissionRunsGetRun(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/abort.js", () => ({
  consumeMissionRunAbortIntent: (...a: unknown[]) => mockConsumeAbortIntent(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/runtime-continuation.js", () => ({
  isContinuableRuntimeStop: (...a: unknown[]) => mockIsContinuableRuntimeStop(...a),
  scheduleRuntimeContinuation: vi.fn(),
}));

vi.mock("../../../../../vex-agent/engine/mission/mission-results-capture.js", () => ({
  captureMissionFinal: (...a: unknown[]) => mockCaptureMissionFinal(...a),
  captureMissionStart: vi.fn(),
}));

import { finalizeMissionRunStatus } from "../../../../../vex-agent/engine/core/runner/mission-finalize.js";

describe("finalizeMissionRunStatus — deadline_reached", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMissionRunsGetRun.mockResolvedValue(null);
    mockConsumeAbortIntent.mockReturnValue(null);
    mockIsContinuableRuntimeStop.mockReturnValue(false);
  });

  it("closes the mission-results ledger with outcome 'timed_out', not 'failed'", async () => {
    await finalizeMissionRunStatus("mission-1", "run-1", "session-1", "deadline_reached");

    expect(mockCaptureMissionFinal).toHaveBeenCalledTimes(1);
    const arg = mockCaptureMissionFinal.mock.calls[0]![0] as { outcome: string };
    expect(arg.outcome).toBe("timed_out");
  });
});
