/**
 * LIFECYCLE GUARD — Deadline enforcement (force-liquidate-on-deadline).
 *
 * Guards: a mission run that reaches its hard deadline force-liquidates any open
 * positions and finalizes with `stop_reason=deadline_reached`. The turn loop
 * enforces the deadline (see turn-loop.ts, covered by mission-deadline unit
 * tests); THIS suite guards the RUN-BODY seam: when the loop returns
 * `deadline_reached`, the REAL `forceLiquidateOnDeadline` hook fires BEFORE
 * finalize so the run ends flat, on BOTH the start and the resume path.
 *
 * Coverage gap this fills (see suite index): the existing integration test
 * (`mission-run-token-budget.test.ts`) drives ONLY the resume path and ONLY the
 * `token_budget_exhausted` stop. The start path (`runPreparedMissionStart`) had
 * NO integrated force-liquidation test at all, and NO test drove either entry
 * point to `deadline_reached`. This guards the `forceLiquidateOnDeadline`
 * predicate (mission-liquidate-hook.ts) against a regression that drops the
 * deadline branch or reorders liquidate/finalize.
 *
 * Seams mocked mirror the existing runner tests: LLM/turn-loop, hydrate, DB
 * repos, finalize. The liquidate HOOK runs for real; only the heavy swap graph
 * it dynamically imports (`liquidateMissionPositions`) is stubbed so we can
 * observe it firing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockLiquidate = vi.fn().mockResolvedValue(undefined);
const mockFinalizeStatus = vi.fn().mockResolvedValue("failed");
const mockFinalizeError = vi.fn().mockResolvedValue(undefined);
const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);
const mockCaptureStart = vi.fn().mockResolvedValue(undefined);
const mockAppendEngineMessage = vi.fn().mockResolvedValue(undefined);
const mockReleaseLease = vi.fn().mockResolvedValue(undefined);

const RUN_STARTED_AT = "2026-07-22T12:00:00.000Z";

vi.mock("@vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

vi.mock("@vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...a: unknown[]) => mockRunTurnLoop(...a),
}));

// REAL liquidate hook runs — only the heavy swap graph it dynamically imports
// is stubbed, so we can observe the hook firing on a deadline exit.
vi.mock("@vex-agent/engine/mission/mission-liquidate.js", () => ({
  liquidateMissionPositions: (...a: unknown[]) => mockLiquidate(...a),
}));

vi.mock("@vex-agent/engine/core/runner/mission-finalize.js", () => ({
  finalizeMissionRunStatus: (...a: unknown[]) => mockFinalizeStatus(...a),
  finalizeMissionRunError: (...a: unknown[]) => mockFinalizeError(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
}));

vi.mock("@vex-agent/engine/mission/mission-results-capture.js", () => ({
  captureMissionStart: (...a: unknown[]) => mockCaptureStart(...a),
}));

vi.mock("@vex-agent/engine/events/index.js", () => ({
  appendEngineMessage: (...a: unknown[]) => mockAppendEngineMessage(...a),
}));

vi.mock("@vex-agent/engine/wake/blob-refresh.js", () => ({
  refreshBlobTtlForRecentMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@vex-agent/engine/mission/run-contract.js", () => ({
  resolveMissionPromptContext: vi.fn().mockReturnValue({}),
}));

// Deadline resolution itself is unit-tested elsewhere; the STOP is driven by the
// mocked turn loop, so pin this to null to keep loopConfig construction inert.
vi.mock("@vex-agent/engine/mission/mission-deadline.js", () => ({
  resolveFrozenDeadlineMs: vi.fn().mockReturnValue(null),
  resolveDurationMinutes: vi.fn().mockReturnValue(60),
  frozenDurationMinutes: vi.fn().mockReturnValue(null),
}));

vi.mock("@vex-agent/tools/registry.js", () => ({
  getOpenAITools: vi.fn().mockReturnValue([]),
}));

vi.mock("@vex-agent/engine/core/runner/abort.js", () => ({
  registerMissionRunAbortController: vi.fn().mockReturnValue({ signal: {} }),
  unregisterMissionRunAbortController: vi.fn(),
}));

vi.mock("@vex-agent/engine/runtime/release-and-emit.js", () => ({
  releaseLeaseAndEmitControlState: (...a: unknown[]) => mockReleaseLease(...a),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { runPreparedMissionStart, resumePreparedMissionRun } = await import(
  "@vex-agent/engine/core/runner/mission-run.js"
);

function hydrated() {
  return {
    context: {
      sessionId: "session-1",
      sessionPermission: "restricted",
      sessionKind: "mission",
      missionRunStartedAt: RUN_STARTED_AT,
      planMode: false,
    },
    messages: [],
    summary: null,
    tokenCount: 0,
  };
}

function makeStartPrepared() {
  return {
    runId: "run-1",
    missionId: "mission-1",
    sessionId: "session-1",
    permission: "restricted" as const,
    mission: { id: "mission-1", status: "running" },
    contractSnapshot: { missionPromptContext: {} },
    sessionLease: { release: vi.fn() },
    provider: {},
    config: { contextLimit: 200_000 },
  } as never;
}

function makeResumePrepared() {
  return {
    runId: "run-1",
    run: {
      id: "run-1",
      missionId: "mission-1",
      sessionId: "session-1",
      status: "running" as const,
      startedAt: RUN_STARTED_AT,
      iterationCount: 3,
      contractSnapshotJson: null,
    },
    mission: { id: "mission-1", status: "running" },
    provider: {},
    config: { contextLimit: 200_000 },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFinalizeStatus.mockResolvedValue("failed");
  mockHydrate.mockResolvedValue(hydrated());
});

describe("deadline enforcement — start path (runPreparedMissionStart)", () => {
  it("force-liquidates open positions and finalizes with deadline_reached", async () => {
    mockRunTurnLoop.mockResolvedValue({
      stopReason: "deadline_reached",
      text: "",
      toolCallsMade: 2,
      pendingApprovals: [],
    });

    const result = await runPreparedMissionStart(makeStartPrepared());

    // The REAL hook ran and settled positions before finalize.
    expect(mockLiquidate).toHaveBeenCalledTimes(1);
    expect(mockFinalizeStatus).toHaveBeenCalledWith(
      "mission-1",
      "run-1",
      "session-1",
      "deadline_reached",
      undefined,
    );
    expect(result.stopReason).toBe("deadline_reached");
    expect(result.missionStatus).toBe("failed");
  });

  it("does NOT liquidate on an agent-driven goal_reached stop", async () => {
    mockFinalizeStatus.mockResolvedValue("completed");
    mockRunTurnLoop.mockResolvedValue({
      stopReason: "goal_reached",
      text: "done",
      toolCallsMade: 0,
      pendingApprovals: [],
    });

    await runPreparedMissionStart(makeStartPrepared());
    expect(mockLiquidate).not.toHaveBeenCalled();
  });
});

describe("deadline enforcement — resume path (resumePreparedMissionRun)", () => {
  it("force-liquidates open positions and finalizes with deadline_reached", async () => {
    mockRunTurnLoop.mockResolvedValue({
      stopReason: "deadline_reached",
      text: "",
      toolCallsMade: 1,
      pendingApprovals: [],
    });

    const result = await resumePreparedMissionRun(makeResumePrepared());

    expect(mockLiquidate).toHaveBeenCalledTimes(1);
    expect(mockFinalizeStatus).toHaveBeenCalledWith(
      "mission-1",
      "run-1",
      "session-1",
      "deadline_reached",
      undefined,
    );
    expect(result.stopReason).toBe("deadline_reached");
  });
});
