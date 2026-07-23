/**
 * Integrated RUN-path coverage for the hard token-budget guard (PR #38 review
 * follow-ups). The isolated unit tests in `mission-token-budget.test.ts` pin the
 * env parse, the finalize mapping, and the liquidate-hook predicate in
 * isolation; this file drives `resumePreparedMissionRun` end-to-end (turn loop
 * mocked) to assert the two seams the review flagged as untested:
 *
 *   1. RUN-SCOPING WIRING (fix B) — the run passes its IMMUTABLE `started_at`
 *      as `missionTokenSince` and a non-null `missionTokenBudget` into the turn
 *      loop, so the guard counts only the tokens THIS run spent (not the setup
 *      tokens already on the shared root session). Resume reuses the same
 *      baseline because `started_at` never changes.
 *
 *   2. INTEGRATED FORCE-LIQUIDATION (review gap) — when the loop actually stops
 *      with `token_budget_exhausted`, the REAL liquidate hook fires and settles
 *      open positions before finalize (not just the isolated hook unit).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockLiquidate = vi.fn().mockResolvedValue(undefined);
const mockFinalizeStatus = vi.fn().mockResolvedValue("failed");
const mockFinalizeError = vi.fn().mockResolvedValue(undefined);
const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);

const RUN_STARTED_AT = "2026-07-22T12:00:00.000Z";

vi.mock("../../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...a: unknown[]) => mockRunTurnLoop(...a),
}));

// REAL liquidate hook runs (integrated) — only the heavy swap graph it
// dynamically imports is stubbed, so we can observe it firing.
vi.mock("../../../../../vex-agent/engine/mission/mission-liquidate.js", () => ({
  liquidateMissionPositions: (...a: unknown[]) => mockLiquidate(...a),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/mission-finalize.js", () => ({
  finalizeMissionRunStatus: (...a: unknown[]) => mockFinalizeStatus(...a),
  finalizeMissionRunError: (...a: unknown[]) => mockFinalizeError(...a),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
}));

vi.mock("../../../../../vex-agent/engine/wake/blob-refresh.js", () => ({
  refreshBlobTtlForRecentMessages: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../../vex-agent/engine/mission/run-contract.js", () => ({
  resolveMissionPromptContext: vi.fn().mockReturnValue({}),
}));

vi.mock("../../../../../vex-agent/engine/mission/mission-deadline.js", () => ({
  resolveFrozenDeadlineMs: vi.fn().mockReturnValue(null),
}));

vi.mock("@vex-agent/tools/registry.js", () => ({
  getOpenAITools: vi.fn().mockReturnValue([]),
}));

vi.mock("@vex-agent/engine/events/index.js", () => ({
  appendEngineMessage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../../vex-agent/engine/core/runner/abort.js", () => ({
  registerMissionRunAbortController: vi.fn().mockReturnValue({ signal: {} }),
  unregisterMissionRunAbortController: vi.fn(),
}));

vi.mock("../../../../../vex-agent/engine/runtime/release-and-emit.js", () => ({
  releaseLeaseAndEmitControlState: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { resumePreparedMissionRun } = await import(
  "../../../../../vex-agent/engine/core/runner/mission-run.js"
);

function makePrepared() {
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
  delete process.env.AGENT_MISSION_TOKEN_BUDGET;
  mockFinalizeStatus.mockResolvedValue("failed");
  mockHydrate.mockResolvedValue({
    context: {
      sessionId: "session-1",
      sessionPermission: "restricted",
      sessionKind: "mission",
      // The run's immutable started_at is threaded here by hydrate — the
      // guard's baseline cutoff.
      missionRunStartedAt: RUN_STARTED_AT,
      planMode: false,
    },
    messages: [],
    summary: null,
    tokenCount: 0,
  });
});

describe("resumePreparedMissionRun — token-budget wiring (fix B, run-scoped)", () => {
  it("passes the run's started_at as missionTokenSince and a non-null budget into the turn loop", async () => {
    mockRunTurnLoop.mockResolvedValue({
      stopReason: "goal_reached",
      text: "done",
      toolCallsMade: 0,
      pendingApprovals: [],
    });

    await resumePreparedMissionRun(makePrepared());

    expect(mockRunTurnLoop).toHaveBeenCalledTimes(1);
    // runTurnLoop(context, messages, summary, tokenCount, provider, config,
    //   tools, loopConfig, promptOptions, signal) — loopConfig is index 7.
    const loopConfig = mockRunTurnLoop.mock.calls[0]![7] as {
      missionTokenBudget?: number | null;
      missionTokenSince?: string | null;
    };
    expect(loopConfig.missionTokenBudget).toBe(500_000); // default, env unset
    // Run-scoped to the run's OWN spend, and identical across resume (started_at
    // is immutable) so the baseline is never reset.
    expect(loopConfig.missionTokenSince).toBe(RUN_STARTED_AT);
  });
});

describe("resumePreparedMissionRun — integrated force-liquidation on budget breach", () => {
  it("force-liquidates open positions when the loop stops with token_budget_exhausted", async () => {
    mockRunTurnLoop.mockResolvedValue({
      stopReason: "token_budget_exhausted",
      text: "",
      toolCallsMade: 1,
      pendingApprovals: [],
    });

    const result = await resumePreparedMissionRun(makePrepared());

    // The REAL liquidate hook ran and settled positions before finalize.
    expect(mockLiquidate).toHaveBeenCalledTimes(1);
    // Then flowed through the standard business-stop finalize.
    expect(mockFinalizeStatus).toHaveBeenCalledWith(
      "mission-1",
      "run-1",
      "session-1",
      "token_budget_exhausted",
      undefined,
    );
    expect(result.missionStatus).toBe("failed");
    expect(result.stopReason).toBe("token_budget_exhausted");
  });

  it("does NOT force-liquidate on an ordinary agent-driven stop", async () => {
    mockRunTurnLoop.mockResolvedValue({
      stopReason: "goal_reached",
      text: "done",
      toolCallsMade: 0,
      pendingApprovals: [],
    });

    await resumePreparedMissionRun(makePrepared());
    expect(mockLiquidate).not.toHaveBeenCalled();
  });
});
