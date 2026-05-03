/**
 * /retry — retryActiveMissionRun.
 *
 * Covers: wake-cancel ordering, atomic CAS, and the four refusal paths.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetActiveRunBySession = vi.fn();
const mockCasFlipToRunning = vi.fn();
const mockCancelForSession = vi.fn();
const mockResumeMissionRun = vi.fn();

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRunBySession: (...a: unknown[]) => mockGetActiveRunBySession(...a),
  casFlipToRunning: (...a: unknown[]) => mockCasFlipToRunning(...a),
}));

vi.mock("@vex-agent/db/repos/loop-wake.js", () => ({
  cancelForSession: (...a: unknown[]) => mockCancelForSession(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/mission.js", () => ({
  resumeMissionRun: (...a: unknown[]) => mockResumeMissionRun(...a),
}));

const { retryActiveMissionRun } = await import(
  "../../../../../vex-agent/engine/core/runner/retry.js"
);

const okTurnResult = {
  text: "resumed",
  toolCallsMade: 0,
  pendingApprovals: [],
  stopReason: null,
  missionStatus: "running" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockCancelForSession.mockResolvedValue(0);
  mockCasFlipToRunning.mockResolvedValue("paused_error");
  mockResumeMissionRun.mockResolvedValue(okTurnResult);
});

function activeRun(status: string) {
  return { id: "run-1", missionId: "m-1", sessionId: "s-1", status };
}

describe("retryActiveMissionRun", () => {
  it("rejects with hint when there is no active run", async () => {
    mockGetActiveRunBySession.mockResolvedValue(null);
    await expect(retryActiveMissionRun("s-1")).rejects.toThrow(/No active mission run to retry/);
  });

  it("rejects from paused_approval with the approve/reject hint", async () => {
    mockGetActiveRunBySession.mockResolvedValue(activeRun("paused_approval"));
    await expect(retryActiveMissionRun("s-1")).rejects.toThrow(/awaiting approval/);
    expect(mockCancelForSession).not.toHaveBeenCalled();
    expect(mockCasFlipToRunning).not.toHaveBeenCalled();
  });

  it("rejects from running with 'already in progress'", async () => {
    mockGetActiveRunBySession.mockResolvedValue(activeRun("running"));
    await expect(retryActiveMissionRun("s-1")).rejects.toThrow(/already in progress/);
    expect(mockCasFlipToRunning).not.toHaveBeenCalled();
  });

  it.each([["completed"], ["failed"], ["stopped"], ["cancelled"]] as const)(
    "rejects from terminal status %s",
    async (status) => {
      mockGetActiveRunBySession.mockResolvedValue(activeRun(status));
      await expect(retryActiveMissionRun("s-1")).rejects.toThrow(/cannot be retried/);
      expect(mockCasFlipToRunning).not.toHaveBeenCalled();
    },
  );

  it("cancels pending wakes BEFORE the CAS for paused_error", async () => {
    mockGetActiveRunBySession.mockResolvedValue(activeRun("paused_error"));
    const order: string[] = [];
    mockCancelForSession.mockImplementation(async () => {
      order.push("cancelForSession");
      return 0;
    });
    mockCasFlipToRunning.mockImplementation(async () => {
      order.push("casFlipToRunning");
      return "paused_error";
    });

    await retryActiveMissionRun("s-1");
    expect(order).toEqual(["cancelForSession", "casFlipToRunning"]);
  });

  it("flips paused_error → running and resumes the run", async () => {
    mockGetActiveRunBySession.mockResolvedValue(activeRun("paused_error"));
    mockCasFlipToRunning.mockResolvedValue("paused_error");

    const result = await retryActiveMissionRun("s-1");
    expect(mockCasFlipToRunning).toHaveBeenCalledWith("run-1", expect.arrayContaining(["paused_error", "paused_wake"]));
    expect(mockResumeMissionRun).toHaveBeenCalledWith("run-1");
    expect(result).toEqual(okTurnResult);
  });

  it("flips paused_wake → running and resumes the run", async () => {
    mockGetActiveRunBySession.mockResolvedValue(activeRun("paused_wake"));
    mockCasFlipToRunning.mockResolvedValue("paused_wake");

    const result = await retryActiveMissionRun("s-1");
    expect(mockResumeMissionRun).toHaveBeenCalledWith("run-1");
    expect(result).toEqual(okTurnResult);
  });

  it("refuses cleanly when CAS loses the race (returns null)", async () => {
    mockGetActiveRunBySession.mockResolvedValue(activeRun("paused_wake"));
    mockCasFlipToRunning.mockResolvedValue(null);

    await expect(retryActiveMissionRun("s-1")).rejects.toThrow(/claimed by another resumer/);
    expect(mockResumeMissionRun).not.toHaveBeenCalled();
  });
});
