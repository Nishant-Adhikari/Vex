/**
 * Regression tests — finalize write-order invariants.
 *
 * FINALIZE-01: In the terminal branch of `finalizeMissionRunStatus`, the run
 * row (`mission_runs.updateStatus`) must be written BEFORE the mission row
 * (`missions.setStatus`). The original order was reversed: a crash between
 * the two writes let the orphan reconciler see `mission_runs.status=running`
 * while `missions.status=completed/failed`, then overwrite the mission to
 * `cancelled` — silent status corruption.
 *
 * BAR-002: `emitFinalizeControlState` must fire AFTER `captureMissionFinal`
 * so the renderer sees the canonical terminal mission-results record before it
 * gets the control-state broadcast.
 *
 * closeRunnerLostFinalize: must call `setStatusIfNotTerminal` (guarded) not
 * bare `setStatus`, so the reconciler cannot overwrite a `completed` mission
 * as `cancelled` when a crash occurred between the two writes.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Call-order tracking ────────────────────────────────────────────────────

let callOrder: string[] = [];

// ── Module-level mock handles ──────────────────────────────────────────────

const mockUpdateStatus = vi.fn().mockImplementation(() => {
  callOrder.push("updateStatus");
  return Promise.resolve();
});
const mockSetStatus = vi.fn().mockImplementation(() => {
  callOrder.push("setStatus");
  return Promise.resolve();
});
const mockSetStatusIfNotTerminal = vi.fn().mockImplementation(() => {
  callOrder.push("setStatusIfNotTerminal");
  return Promise.resolve();
});
const mockClearApprovedAt = vi.fn();
// getRun is called inside emitFinalizeControlState — use it as a proxy to
// observe WHEN emitFinalizeControlState fires relative to captureMissionFinal.
const mockGetRun = vi.fn().mockImplementation(() => {
  callOrder.push("getRun");
  return Promise.resolve(null);
});
const mockMarkStoppedIfRunning = vi.fn().mockResolvedValue(true);
const mockCaptureMissionFinal = vi.fn().mockImplementation(() => {
  callOrder.push("captureMissionFinal");
  return Promise.resolve();
});
const mockConsumeAbortIntent = vi.fn().mockReturnValue(null);
const mockIsContinuableRuntimeStop = vi.fn().mockReturnValue(false);
const mockReconcileDraftReadiness = vi.fn().mockResolvedValue({ promoted: false });

// ── Vitest mock declarations (hoisted) ────────────────────────────────────

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  setStatus: (...a: unknown[]) => mockSetStatus(...a),
  setStatusIfNotTerminal: (...a: unknown[]) => mockSetStatusIfNotTerminal(...a),
  clearApprovedAt: (...a: unknown[]) => mockClearApprovedAt(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  getRun: (...a: unknown[]) => mockGetRun(...a),
  markStoppedIfRunning: (...a: unknown[]) => mockMarkStoppedIfRunning(...a),
}));

vi.mock("@vex-agent/db/repos/runner-leases.js", () => ({
  getLease: vi.fn().mockResolvedValue(null),
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

vi.mock("../../../../../vex-agent/engine/mission/draft-readiness.js", () => ({
  reconcileDraftReadiness: (...a: unknown[]) => mockReconcileDraftReadiness(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/mission-auto-retry.js", () => ({
  enqueueAutoRetryWake: vi.fn().mockResolvedValue(undefined),
  persistErrorPauseWithMaybeAutoRetry: vi.fn().mockResolvedValue({ scheduled: null }),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/mission-error-signal.js", () => ({
  readMissionErrorSignal: vi.fn().mockReturnValue({ causeCode: "unknown" }),
}));

vi.mock("@utils/logger.js", () => ({
  default: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import {
  finalizeMissionRunStatus,
  closeRunnerLostFinalize,
} from "../../../../../vex-agent/engine/core/runner/mission-finalize.js";

// ── Shared reset ───────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  callOrder = [];
  // Restore tracking implementations (clearAllMocks resets them to no-ops).
  mockUpdateStatus.mockImplementation(() => {
    callOrder.push("updateStatus");
    return Promise.resolve();
  });
  mockSetStatus.mockImplementation(() => {
    callOrder.push("setStatus");
    return Promise.resolve();
  });
  mockSetStatusIfNotTerminal.mockImplementation(() => {
    callOrder.push("setStatusIfNotTerminal");
    return Promise.resolve();
  });
  mockGetRun.mockImplementation(() => {
    callOrder.push("getRun");
    return Promise.resolve(null);
  });
  mockCaptureMissionFinal.mockImplementation(() => {
    callOrder.push("captureMissionFinal");
    return Promise.resolve();
  });
  mockConsumeAbortIntent.mockReturnValue(null);
  mockIsContinuableRuntimeStop.mockReturnValue(false);
  mockMarkStoppedIfRunning.mockResolvedValue(true);
  mockReconcileDraftReadiness.mockResolvedValue({ promoted: false });
});

// ══════════════════════════════════════════════════════════════════════════
// FINALIZE-01 — updateStatus written BEFORE setStatus
// ══════════════════════════════════════════════════════════════════════════

describe("FINALIZE-01: mission_runs updateStatus written before missions setStatus", () => {
  it("FINALIZE-01: goal_reached — updateStatus before setStatus", async () => {
    await finalizeMissionRunStatus("m1", "r1", "s1", "goal_reached");

    const updateIdx = callOrder.indexOf("updateStatus");
    const setIdx = callOrder.indexOf("setStatus");
    expect(updateIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(setIdx);
  });

  it("FINALIZE-01: deadline_reached — updateStatus before setStatus", async () => {
    await finalizeMissionRunStatus("m1", "r1", "s1", "deadline_reached");

    const updateIdx = callOrder.indexOf("updateStatus");
    const setIdx = callOrder.indexOf("setStatus");
    expect(updateIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(setIdx);
  });

  it("FINALIZE-01: user_stopped (non-edit path) — updateStatus before setStatus", async () => {
    // consumeAbortIntent returns null → takes the non-edit terminal path
    mockConsumeAbortIntent.mockReturnValue(null);

    await finalizeMissionRunStatus("m1", "r1", "s1", "user_stopped");

    const updateIdx = callOrder.indexOf("updateStatus");
    const setIdx = callOrder.indexOf("setStatus");
    expect(updateIdx).toBeGreaterThan(-1);
    expect(setIdx).toBeGreaterThan(-1);
    expect(updateIdx).toBeLessThan(setIdx);
  });

  it("FINALIZE-01: updateStatus is passed the run id and correct terminal status for goal_reached", async () => {
    await finalizeMissionRunStatus("mission-1", "run-1", "sess-1", "goal_reached");

    expect(mockUpdateStatus).toHaveBeenCalledWith(
      "run-1",
      "completed",
      "goal_reached",
      undefined,
    );
  });

  it("FINALIZE-01: setStatus is never called before updateStatus resolves (call index check)", async () => {
    // Both mocks push to callOrder in order — if setStatus were first we'd see
    // setStatus at index 0, updateStatus at index 1.
    await finalizeMissionRunStatus("m1", "r1", "s1", "deadline_reached");

    // updateStatus must appear before setStatus in the shared call log
    expect(callOrder[0]).toBe("updateStatus");
    expect(callOrder[1]).toBe("setStatus");
  });
});

// ══════════════════════════════════════════════════════════════════════════
// BAR-002 — captureMissionFinal fires BEFORE emitFinalizeControlState
// ══════════════════════════════════════════════════════════════════════════

describe("BAR-002: captureMissionFinal fires before emitFinalizeControlState", () => {
  // emitFinalizeControlState is a private function. It calls
  // missionRunsRepo.getRun internally as its first DB side-effect — we use
  // that call as a proxy for "emitFinalizeControlState started".

  it("BAR-002: goal_reached — captureMissionFinal before getRun (emitFinalizeControlState proxy)", async () => {
    await finalizeMissionRunStatus("m1", "r1", "s1", "goal_reached");

    const captureIdx = callOrder.indexOf("captureMissionFinal");
    const getRunIdx = callOrder.indexOf("getRun");
    expect(captureIdx).toBeGreaterThan(-1);
    expect(getRunIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeLessThan(getRunIdx);
  });

  it("BAR-002: deadline_reached — captureMissionFinal before getRun (emitFinalizeControlState proxy)", async () => {
    await finalizeMissionRunStatus("m1", "r1", "s1", "deadline_reached");

    const captureIdx = callOrder.indexOf("captureMissionFinal");
    const getRunIdx = callOrder.indexOf("getRun");
    expect(captureIdx).toBeGreaterThan(-1);
    expect(getRunIdx).toBeGreaterThan(-1);
    expect(captureIdx).toBeLessThan(getRunIdx);
  });

  it("BAR-002: full terminal sequence for goal_reached is updateStatus→setStatus→captureMissionFinal→emitFinalizeControlState(getRun)", async () => {
    await finalizeMissionRunStatus("m1", "r1", "s1", "goal_reached");

    // All four must appear in strict order
    const [u, s, c, g] = [
      callOrder.indexOf("updateStatus"),
      callOrder.indexOf("setStatus"),
      callOrder.indexOf("captureMissionFinal"),
      callOrder.indexOf("getRun"),
    ];
    expect(u).toBeLessThan(s);
    expect(s).toBeLessThan(c);
    expect(c).toBeLessThan(g);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// closeRunnerLostFinalize — uses setStatusIfNotTerminal (guarded write)
// ══════════════════════════════════════════════════════════════════════════

describe("closeRunnerLostFinalize: uses setStatusIfNotTerminal, not bare setStatus", () => {
  it("calls setStatusIfNotTerminal with (missionId, 'cancelled')", async () => {
    await closeRunnerLostFinalize("mission-1", "run-1", "sess-1");

    expect(mockSetStatusIfNotTerminal).toHaveBeenCalledTimes(1);
    expect(mockSetStatusIfNotTerminal).toHaveBeenCalledWith("mission-1", "cancelled");
  });

  it("does NOT call bare setStatus", async () => {
    await closeRunnerLostFinalize("mission-1", "run-1", "sess-1");

    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("still calls captureMissionFinal with outcome='stopped' and stopReason='runner_lost'", async () => {
    await closeRunnerLostFinalize("mission-1", "run-1", "sess-1");

    expect(mockCaptureMissionFinal).toHaveBeenCalledTimes(1);
    const arg = mockCaptureMissionFinal.mock.calls[0]![0] as {
      outcome: string;
      stopReason: string;
    };
    expect(arg.outcome).toBe("stopped");
    expect(arg.stopReason).toBe("runner_lost");
  });
});
