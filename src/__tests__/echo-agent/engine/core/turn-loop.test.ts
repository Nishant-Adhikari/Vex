import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockAddMessage = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockGetLiveMessages = vi.fn().mockResolvedValue([]);
const mockDispatchTool = vi.fn();
const mockIncrementIterations = vi.fn().mockResolvedValue(1);
const mockUpdateStatus = vi.fn();
const mockSetLastCheckpoint = vi.fn();

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

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  updateTokenCount: vi.fn(),
  checkpointSession: vi.fn(),
  archiveMessages: vi.fn(),
  getSession: vi.fn().mockResolvedValue({ tokenCount: 0 }),
}));

vi.mock("@echo-agent/db/repos/approvals.js", () => ({
  enqueue: vi.fn(),
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

describe("turn-loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeContext(overrides = {}) {
    return {
      sessionId: "session-1",
      sessionKind: "chat" as const,
      loopMode: "off" as const,
      missionId: null,
      missionRunId: null,
      isSubagent: false,
      loadedDocuments: new Map<string, string>(),
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
      contextLimit: 128000,
      maxOutputTokens: 4096,
      inputPricePerM: 3,
      outputPricePerM: 15,
    };
  }

  const defaultLoopConfig = {
    maxIterations: 10,
    timeoutMs: 60000,
    contextLimit: 128000,
  };

  // ── Chat mode ───────────────────────────────────────────────

  describe("chat mode", () => {
    it("stops after text response", async () => {
      const provider = makeProvider([{ content: "Hello!" }]);
      const result = await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.text).toBe("Hello!");
      expect(result.toolCallsMade).toBe(0);
      expect(result.stopReason).toBeNull();
      expect(provider.chatCompletion).toHaveBeenCalledTimes(1);
    });

    it("handles tool call then text response", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "discover_tools", arguments: { query: "balance" } }] },
        { content: "Your balance is 2.5 SOL" },
      ]);
      mockDispatchTool.mockResolvedValue({ success: true, output: '{"balance":"2.5"}' });

      const result = await runTurnLoop(
        makeContext(), [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.text).toBe("Your balance is 2.5 SOL");
      expect(result.toolCallsMade).toBe(1);
    });
  });

  // ── Mission mode ────────────────────────────────────────────

  describe("mission mode", () => {
    it("does not stop on text — adds continue message", async () => {
      const provider = makeProvider([
        { content: "Assessing market conditions..." },
        { content: "No opportunity found — stopping." },
      ]);

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        { ...defaultLoopConfig, maxIterations: 3 },
      );

      // Should have called inference at least 2 times (text + continue)
      expect(provider.chatCompletion.mock.calls.length).toBeGreaterThanOrEqual(2);
      // Engine should have added continue message
      expect(mockAddEngineMessage).toHaveBeenCalled();
    });

    it("increments iterations for mission runs", async () => {
      const provider = makeProvider([{ content: "Working..." }]);

      await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        { ...defaultLoopConfig, maxIterations: 1 },
      );

      expect(mockIncrementIterations).toHaveBeenCalledWith("run-1");
    });
  });

  // ── Approval pause ──────────────────────────────────────────

  describe("approval pause", () => {
    it("pauses on pendingApproval from dispatch", async () => {
      const provider = makeProvider([
        { toolCalls: [{ id: "call-1", name: "execute_tool", arguments: { toolId: "solana.swap" } }] },
      ]);
      mockDispatchTool.mockResolvedValue({
        success: false,
        output: "Approval required for swap",
        pendingApproval: true,
      });

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1", loopMode: "restricted" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        defaultLoopConfig,
      );

      expect(result.stopReason).toBe("approval_required");
      expect(result.pendingApprovals).toHaveLength(1);
      expect(result.pendingApprovals[0]).toMatch(/^approval-/);
      expect(mockUpdateStatus).toHaveBeenCalledWith("run-1", "paused_approval", "approval_required");
    });
  });

  // ── Iteration limit ─────────────────────────────────────────

  describe("iteration limit", () => {
    it("stops at maxIterations for mission", async () => {
      const provider = makeProvider([
        { content: "Still working..." },
        { content: "Still going..." },
      ]);

      const result = await runTurnLoop(
        makeContext({ sessionKind: "mission", missionRunId: "run-1" }),
        [], null, 0, provider as any, makeConfig() as any, [],
        { ...defaultLoopConfig, maxIterations: 0 },
      );

      expect(result.stopReason).toBe("iteration_limit");
    });
  });
});
