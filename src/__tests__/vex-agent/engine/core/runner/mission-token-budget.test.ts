/**
 * Hard per-mission TOKEN BUDGET guard.
 *
 * A runaway mission (a broken model looped `mission_draft_update` and burned
 * ~9M tokens / ~$3 with no backstop) must be auto-aborted once its cumulative
 * token spend crosses a configurable ceiling. This file pins three seams of
 * that guard that live OUTSIDE the turn loop itself (the loop-stop behaviour is
 * covered in `turn-loop/mission-mode.test.ts`):
 *
 *   1. Env parse — `AGENT_MISSION_TOKEN_BUDGET` (whole tokens), default 500000
 *      when unset/invalid, matching the fail-open convention of the other
 *      AGENT_* reads.
 *   2. Finalize mapping — a run stopped with the new `token_budget_exhausted`
 *      business stop finalizes as a terminal `failed` run whose ledger record
 *      carries the DISTINCT stop reason (not `deadline_reached`, not a generic
 *      failure), mirroring `mission-finalize-timed-out.test.ts`.
 *   3. Force-close reuse — the budget breach reuses the SAME deadline
 *      force-liquidation hook so open positions are settled before finalize,
 *      exactly like `deadline_reached`.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveMissionTokenBudget } from "../../../../../lib/agent-config.js";

// ── 1. Env parse ────────────────────────────────────────────────

describe("resolveMissionTokenBudget — AGENT_MISSION_TOKEN_BUDGET", () => {
  it("defaults to 500000 when unset", () => {
    expect(resolveMissionTokenBudget({})).toBe(500_000);
  });

  it("defaults to 500000 when blank/whitespace", () => {
    expect(resolveMissionTokenBudget({ AGENT_MISSION_TOKEN_BUDGET: "" })).toBe(500_000);
    expect(resolveMissionTokenBudget({ AGENT_MISSION_TOKEN_BUDGET: "   " })).toBe(500_000);
  });

  it("parses a valid whole-number budget", () => {
    expect(resolveMissionTokenBudget({ AGENT_MISSION_TOKEN_BUDGET: "1200000" })).toBe(1_200_000);
  });

  it("falls back to 500000 on a non-numeric value", () => {
    expect(resolveMissionTokenBudget({ AGENT_MISSION_TOKEN_BUDGET: "lots" })).toBe(500_000);
    expect(resolveMissionTokenBudget({ AGENT_MISSION_TOKEN_BUDGET: "1.5e6" })).toBe(500_000);
  });

  it("falls back to 500000 on a non-positive / out-of-range value", () => {
    expect(resolveMissionTokenBudget({ AGENT_MISSION_TOKEN_BUDGET: "0" })).toBe(500_000);
    expect(resolveMissionTokenBudget({ AGENT_MISSION_TOKEN_BUDGET: "-1" })).toBe(500_000);
  });
});

// ── 2. Finalize mapping ─────────────────────────────────────────

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

describe("finalizeMissionRunStatus — token_budget_exhausted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMissionRunsGetRun.mockResolvedValue(null);
    mockConsumeAbortIntent.mockReturnValue(null);
    mockIsContinuableRuntimeStop.mockReturnValue(false);
  });

  it("terminates the run as 'failed' and stamps the distinct stop reason", async () => {
    const status = await finalizeMissionRunStatus(
      "mission-1",
      "run-1",
      "session-1",
      "token_budget_exhausted",
    );

    // Terminal business stop — the run/mission row end 'failed' (there is no
    // 'timed_out'-style relabel for a budget abort: it is an abnormal end).
    expect(status).toBe("failed");
    expect(mockMissionsSetStatus).toHaveBeenCalledWith("mission-1", "failed");
    expect(mockMissionRunsUpdateStatus).toHaveBeenCalledWith(
      "run-1",
      "failed",
      "token_budget_exhausted",
      undefined,
    );

    // The ledger record keeps the DISTINCT reason so the operator can tell a
    // budget abort apart from a plain failure.
    expect(mockCaptureMissionFinal).toHaveBeenCalledTimes(1);
    const arg = mockCaptureMissionFinal.mock.calls[0]![0] as {
      outcome: string;
      stopReason: string;
    };
    expect(arg.outcome).toBe("failed");
    expect(arg.stopReason).toBe("token_budget_exhausted");
  });
});

// ── 3. Force-close reuse ────────────────────────────────────────

const mockLiquidate = vi.fn().mockResolvedValue(undefined);
vi.mock("../../../../../vex-agent/engine/mission/mission-liquidate.js", () => ({
  liquidateMissionPositions: (...a: unknown[]) => mockLiquidate(...a),
}));

import { forceLiquidateOnDeadline } from "../../../../../vex-agent/engine/core/runner/mission-liquidate-hook.js";

describe("forceLiquidateOnDeadline — budget abort settles positions", () => {
  beforeEach(() => {
    mockLiquidate.mockClear();
  });

  const baseArgs = {
    missionId: "m",
    runId: "r",
    sessionId: "s",
    context: {} as never,
  };

  it("force-liquidates on token_budget_exhausted (reuses the deadline path)", async () => {
    await forceLiquidateOnDeadline({ ...baseArgs, stopReason: "token_budget_exhausted" });
    expect(mockLiquidate).toHaveBeenCalledTimes(1);
  });

  it("still force-liquidates on deadline_reached", async () => {
    await forceLiquidateOnDeadline({ ...baseArgs, stopReason: "deadline_reached" });
    expect(mockLiquidate).toHaveBeenCalledTimes(1);
  });

  it("does NOT liquidate on an ordinary business stop", async () => {
    await forceLiquidateOnDeadline({ ...baseArgs, stopReason: "goal_reached" });
    expect(mockLiquidate).not.toHaveBeenCalled();
  });
});
