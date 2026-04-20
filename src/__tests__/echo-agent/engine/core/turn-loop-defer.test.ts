/**
 * PR-6 — turn-loop integration of the `defer_until` engine signal.
 *
 * Covered here:
 *   - `loop_defer` tool emission parks the mission run in `paused_wake`
 *     (both the mission_runs.updateStatus call and the returned stopReason).
 *   - State exclusivity / precedence:
 *       - `approval_required` in the same batch wins over a later `loop_defer`
 *         (turn-loop breaks on approval first, so the defer never dispatches).
 *       - `stop_mission` in the same batch wins over a later `loop_defer`.
 *   - Checkpoint-before-wait: when `contextUsageBand === "critical"` at the
 *     moment of wake entry, `maybeRunCheckpoint()` fires BEFORE the loop
 *     returns, so post-wake resume starts from a compacted prompt.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAddMessage = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockGetLiveMessages = vi.fn().mockResolvedValue([]);
const mockDispatchTool = vi.fn();
const mockIncrementIterations = vi.fn().mockResolvedValue(1);
const mockUpdateStatus = vi.fn();
const mockSetLastCheckpoint = vi.fn();
const mockEnqueueApproval = vi.fn();

vi.mock("@echo-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: (...a: unknown[]) => mockAddEngineMessage(...a),
  getLiveMessages: (...a: unknown[]) => mockGetLiveMessages(...a),
}));

vi.mock("@echo-agent/db/repos/mission-runs.js", () => ({
  incrementIterations: (...a: unknown[]) => mockIncrementIterations(...a),
  updateStatus: (...a: unknown[]) => mockUpdateStatus(...a),
  setLastCheckpoint: (...a: unknown[]) => mockSetLastCheckpoint(...a),
}));

vi.mock("@echo-agent/tools/dispatcher.js", () => ({
  dispatchTool: (...a: unknown[]) => mockDispatchTool(...a),
}));

const mockGetSessionForLoop = vi.fn().mockResolvedValue({ tokenCount: 0 });

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  updateTokenCount: vi.fn(),
  setRollingSummary: vi.fn(),
  archivePrefix: vi.fn(),
  forkToolMessageToArchive: vi.fn(),
  setMemoryScopeKey: vi.fn(),
  getSession: (...a: unknown[]) => mockGetSessionForLoop(...a),
}));

const mockExecuteCheckpoint = vi.fn().mockResolvedValue({
  mode: "prefix",
  summary: "new rolling summary",
  episodeIds: [],
});

vi.mock("@echo-agent/engine/core/checkpoint.js", async () => {
  const actual = await vi.importActual<typeof import("../../../../echo-agent/engine/core/checkpoint.js")>(
    "@echo-agent/engine/core/checkpoint.js",
  );
  return {
    ...actual,
    executeCheckpoint: (...a: unknown[]) => mockExecuteCheckpoint(...a),
  };
});

vi.mock("@echo-agent/db/repos/approvals.js", () => ({
  enqueue: (...a: unknown[]) => mockEnqueueApproval(...a),
}));

vi.mock("@echo-agent/db/repos/usage.js", () => ({
  logUsage: vi.fn(),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock("@echo-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { runTurnLoop } = await import("../../../../echo-agent/engine/core/turn-loop.js");

// ── Helpers ───────────────────────────────────────────────────

function makeContext(overrides = {}) {
  return {
    sessionId: "session-1",
    sessionKind: "mission" as const,
    loopMode: "restricted" as const,
    missionId: "mission-1",
    missionRunId: "run-1",
    isSubagent: false,
    loadedDocuments: new Map<string, string>(),
    memoryScopeKey: "session-1",
    ...overrides,
  };
}

function makeProvider(responses: Array<{
  content?: string | null;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }> | null;
}>) {
  let callIndex = 0;
  return {
    chatCompletion: vi.fn().mockImplementation(() => {
      const resp = responses[callIndex] ?? responses[responses.length - 1];
      callIndex++;
      return Promise.resolve({
        content: resp.content ?? null,
        toolCalls: resp.toolCalls ?? null,
        usage: { promptTokens: 1000, completionTokens: 200, cachedTokens: 0, reasoningTokens: 0 },
      });
    }),
    calculateCost: vi.fn().mockReturnValue({ totalCost: 0.001, currency: "USD" }),
  };
}

function makeConfig() {
  return {
    provider: "openrouter",
    model: "test-model",
    contextLimit: 128_000,
    timeoutMs: 300_000,
  };
}

function makeLoopConfig() {
  return {
    maxIterations: 5,
    timeoutMs: 300_000,
    contextLimit: 128_000,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSessionForLoop.mockResolvedValue({ tokenCount: 0 });
});

// ── loop_defer → paused_wake ──────────────────────────────────

describe("turn-loop — defer_until signal", () => {
  it("parks mission run in paused_wake and returns waiting_for_wake stopReason", async () => {
    mockDispatchTool.mockResolvedValueOnce({
      success: true,
      output: "Loop deferred until 2026-04-20T11:00:00.000Z",
      data: { defer_id: "wake-xyz", due_at: "2026-04-20T11:00:00.000Z" },
      engineSignal: {
        type: "defer_until",
        reason: "waiting for settlement",
        summary: "Deferred until 2026-04-20T11:00:00.000Z",
        dueAt: "2026-04-20T11:00:00.000Z",
      },
    });

    const provider = makeProvider([
      {
        content: "Deferring until settlement completes.",
        toolCalls: [{ id: "tc-1", name: "loop_defer", arguments: { after_ms: 60_000, reason: "waiting for settlement" } }],
      },
    ]);

    const result = await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      makeConfig() as any,
      [],
      makeLoopConfig(),
    );

    expect(result.stopReason).toBe("waiting_for_wake");
    expect(result.stopPayload?.evidence).toMatchObject({
      dueAt: "2026-04-20T11:00:00.000Z",
      reason: "waiting for settlement",
    });

    // Mission run flipped to paused_wake with the right stop reason.
    const updateCalls = mockUpdateStatus.mock.calls.filter((c) => c[0] === "run-1");
    expect(updateCalls.length).toBeGreaterThan(0);
    expect(updateCalls[updateCalls.length - 1][1]).toBe("paused_wake");
    expect(updateCalls[updateCalls.length - 1][2]).toBe("waiting_for_wake");
  });

  it("saves the assistant batch (user-facing message + tool call) before exiting", async () => {
    mockDispatchTool.mockResolvedValueOnce({
      success: true,
      output: "Loop deferred",
      engineSignal: {
        type: "defer_until",
        reason: "hint",
        summary: "deferred",
        dueAt: "2030-01-01T00:00:00.000Z",
      },
    });

    const provider = makeProvider([
      {
        content: "I'll pause until X.",
        toolCalls: [{ id: "tc-1", name: "loop_defer", arguments: { after_ms: 10_000, reason: "hint" } }],
      },
    ]);

    await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      makeConfig() as any,
      [],
      makeLoopConfig(),
    );

    // The assistant message (with the tool call) is persisted by saveAssistantMessage →
    // messagesRepo.addMessage. The tool-result for loop_defer is also persisted.
    const toolResultCalls = mockAddMessage.mock.calls.filter((c) => c[1]?.role === "tool");
    expect(toolResultCalls.length).toBe(1);
  });
});

// ── Precedence ────────────────────────────────────────────────

describe("turn-loop — state exclusivity", () => {
  it("approval_required in the same batch wins over a later loop_defer (defer never dispatches)", async () => {
    // First tool triggers approval → turn-loop breaks before dispatching the
    // second (loop_defer), so mockDispatchTool is only called once.
    mockDispatchTool.mockResolvedValueOnce({
      success: false,
      output: "approval needed",
      pendingApproval: true,
    });

    const provider = makeProvider([
      {
        content: "Need approval then defer.",
        toolCalls: [
          { id: "tc-1", name: "wallet_send_prepare", arguments: {} },
          { id: "tc-2", name: "loop_defer", arguments: { after_ms: 10_000, reason: "then sleep" } },
        ],
      },
    ]);

    const result = await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      makeConfig() as any,
      [],
      makeLoopConfig(),
    );

    expect(result.stopReason).toBe("approval_required");
    // Only the first tool dispatched.
    expect(mockDispatchTool).toHaveBeenCalledTimes(1);

    // Mission run moved to paused_approval, NOT paused_wake.
    const statusWrites = mockUpdateStatus.mock.calls.filter((c) => c[0] === "run-1");
    expect(statusWrites.some((c) => c[1] === "paused_approval")).toBe(true);
    expect(statusWrites.some((c) => c[1] === "paused_wake")).toBe(false);
  });

  it("stop_mission in the same batch wins over a later loop_defer", async () => {
    mockDispatchTool.mockResolvedValueOnce({
      success: true,
      output: "stopping",
      engineSignal: {
        type: "stop_mission",
        reason: "goal_reached",
        summary: "done",
      },
    });

    const provider = makeProvider([
      {
        content: "Done, but also deferring (should not take).",
        toolCalls: [
          { id: "tc-1", name: "mission_stop", arguments: { reason: "goal_reached", summary: "done" } },
          { id: "tc-2", name: "loop_defer", arguments: { after_ms: 10_000, reason: "no-op" } },
        ],
      },
    ]);

    const result = await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      makeConfig() as any,
      [],
      makeLoopConfig(),
    );

    expect(result.stopReason).toBe("goal_reached");
    expect(mockDispatchTool).toHaveBeenCalledTimes(1);

    // Mission run never saw paused_wake.
    const statusWrites = mockUpdateStatus.mock.calls.filter((c) => c[0] === "run-1");
    expect(statusWrites.some((c) => c[1] === "paused_wake")).toBe(false);
  });
});

// ── Checkpoint-before-wait ────────────────────────────────────

describe("turn-loop — checkpoint-before-wait", () => {
  it("does NOT run checkpoint when band is normal at wake entry", async () => {
    mockGetSessionForLoop.mockResolvedValue({ tokenCount: 10_000 }); // ~7.8%

    mockDispatchTool.mockResolvedValueOnce({
      success: true,
      output: "deferred",
      engineSignal: {
        type: "defer_until",
        reason: "hint",
        summary: "deferred",
        dueAt: "2030-01-01T00:00:00.000Z",
      },
    });

    const provider = makeProvider([
      {
        content: "Pausing.",
        toolCalls: [{ id: "tc-1", name: "loop_defer", arguments: { after_ms: 10_000, reason: "hint" } }],
      },
    ]);

    await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      makeConfig() as any,
      [],
      makeLoopConfig(),
    );

    expect(mockExecuteCheckpoint).not.toHaveBeenCalled();
  });

  it("DOES run checkpoint when band is critical at wake entry", async () => {
    // 128_000 * 0.90 = 115_200 → tokenCount just over that triggers critical.
    mockGetSessionForLoop.mockResolvedValue({ tokenCount: 120_000 });

    mockDispatchTool.mockResolvedValueOnce({
      success: true,
      output: "deferred",
      engineSignal: {
        type: "defer_until",
        reason: "pressure",
        summary: "deferred",
        dueAt: "2030-01-01T00:00:00.000Z",
      },
    });

    const provider = makeProvider([
      {
        content: "Pausing under pressure.",
        toolCalls: [{ id: "tc-1", name: "loop_defer", arguments: { after_ms: 10_000, reason: "pressure" } }],
      },
    ]);

    const result = await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      makeConfig() as any,
      [],
      makeLoopConfig(),
    );

    expect(result.stopReason).toBe("waiting_for_wake");
    // Checkpoint-before-wait fired so resume starts compacted.
    expect(mockExecuteCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("runs checkpoint BEFORE flipping the run to paused_wake (PR-13 M-3)", async () => {
    mockGetSessionForLoop.mockResolvedValue({ tokenCount: 120_000 });

    mockDispatchTool.mockResolvedValueOnce({
      success: true,
      output: "deferred",
      engineSignal: {
        type: "defer_until",
        reason: "pressure",
        summary: "deferred",
        dueAt: "2030-01-01T00:00:00.000Z",
      },
    });

    const provider = makeProvider([
      {
        content: "Pausing under pressure.",
        toolCalls: [{ id: "tc-1", name: "loop_defer", arguments: { after_ms: 10_000, reason: "pressure" } }],
      },
    ]);

    await runTurnLoop(
      makeContext(),
      [],
      null,
      0,
      provider as any,
      makeConfig() as any,
      [],
      makeLoopConfig(),
    );

    // Both hooks were called once — this test asserts their RELATIVE order:
    // checkpoint must have landed before updateStatus(paused_wake) so
    // ingress / wake executor never see paused_wake during a running
    // compaction (audit M-3).
    const checkpointCall = mockExecuteCheckpoint.mock.invocationCallOrder[0];
    const pausedWakeCall = mockUpdateStatus.mock.invocationCallOrder.find((_, idx) => {
      const args = mockUpdateStatus.mock.calls[idx];
      return args && args[1] === "paused_wake";
    });
    expect(checkpointCall).toBeDefined();
    expect(pausedWakeCall).toBeDefined();
    expect(checkpointCall).toBeLessThan(pausedWakeCall!);
  });
});
