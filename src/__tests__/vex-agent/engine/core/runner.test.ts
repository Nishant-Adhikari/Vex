import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockResolveProvider = vi.fn();
const mockAddMessage = vi.fn();
const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockGetMission = vi.fn();
const mockSetMissionStatus = vi.fn();
const mockSetApprovedAt = vi.fn();
const mockCreateRun = vi.fn();
const mockGetRun = vi.fn();
const mockUpdateRunStatus = vi.fn();

vi.mock("@vex-agent/inference/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessage: (...a: unknown[]) => mockAddMessage(...a),
  addEngineMessage: vi.fn(),
  getLiveMessages: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...a: unknown[]) => mockHydrate(...a),
}));

vi.mock("../../../../vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...a: unknown[]) => mockRunTurnLoop(...a),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...a: unknown[]) => mockGetMission(...a),
  setStatus: (...a: unknown[]) => mockSetMissionStatus(...a),
  setApprovedAt: (...a: unknown[]) => mockSetApprovedAt(...a),
  getMissionBySession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  createRun: (...a: unknown[]) => mockCreateRun(...a),
  getRun: (...a: unknown[]) => mockGetRun(...a),
  updateStatus: (...a: unknown[]) => mockUpdateRunStatus(...a),
  getActiveRun: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/tools/registry.js", () => ({
  getOpenAITools: vi.fn().mockReturnValue([]),
}));

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  getSession: vi.fn(),
  updateTokenCount: vi.fn(),
  createSession: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/session-links.js", () => ({
  getParentSession: vi.fn().mockResolvedValue(null),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

vi.mock("@vex-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { processChatTurn, startMission, resumeMissionRun } = await import(
  "../../../../vex-agent/engine/core/runner.js"
);

function makeProvider() {
  return {
    loadConfig: vi.fn().mockResolvedValue({
      provider: "openrouter",
      model: "test",
      contextLimit: 128000,
      maxOutputTokens: 4096,
    }),
  };
}

function makeHydratedSession(overrides = {}) {
  return {
    context: {
      sessionId: "session-1",
      sessionKind: "chat",
      loopMode: "off",
      missionId: null,
      missionRunId: null,
      isSubagent: false,
      loadedDocuments: new Map(),
      memoryScopeKey: "session-1",
      ...overrides,
    },
    messages: [],
    summary: null,
    tokenCount: 0,
  };
}

describe("runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProvider.mockResolvedValue(makeProvider());
  });

  // ── processChatTurn ─────────────────────────────────────────

  describe("processChatTurn", () => {
    it("saves user message and runs turn loop", async () => {
      mockHydrate.mockResolvedValueOnce(makeHydratedSession());
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Hello!", toolCallsMade: 0, pendingApprovals: [], stopReason: null,
      });

      const result = await processChatTurn("session-1", "Hi");

      expect(mockAddMessage).toHaveBeenCalledWith(
        "session-1",
        expect.objectContaining({ role: "user", content: "Hi" }),
        expect.objectContaining({ source: "user", messageType: "chat" }),
      );
      expect(result.text).toBe("Hello!");
      expect(result.missionStatus).toBeNull();
    });

    it("throws if no provider", async () => {
      mockResolveProvider.mockResolvedValueOnce(null);
      await expect(processChatTurn("session-1", "Hi")).rejects.toThrow("No inference provider");
    });

    it("throws if session not found", async () => {
      mockHydrate.mockResolvedValueOnce(null);
      await expect(processChatTurn("nonexistent", "Hi")).rejects.toThrow("not found");
    });
  });

  // ── startMission ────────────────────────────────────────────

  describe("startMission", () => {
    it("validates, freezes, creates run, and enters loop", async () => {
      mockGetMission.mockResolvedValueOnce({
        id: "mission-1",
        rootSessionId: "session-1",
        status: "ready",
        title: "SOL DCA",
        goal: "Accumulate 10 SOL",
        capitalSourceJson: { type: "wallet", amount: "500 USDC" },
        allowedWallets: ["solana"],
        allowedChains: ["solana"],
        allowedProtocols: ["solana"],
        riskProfile: "conservative",
        successCriteriaJson: ["Accumulated 10 SOL"],
        stopConditionsJson: ["capital_depleted"],
        constraintsJson: {},
        createdAt: "2026-03-29",
        updatedAt: "2026-03-29",
        approvedAt: null,
      });
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({ sessionKind: "mission" }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Starting mission...", toolCallsMade: 2, pendingApprovals: [], stopReason: null,
      });

      const result = await startMission("mission-1");

      expect(mockSetMissionStatus).toHaveBeenCalledWith("mission-1", "running");
      expect(mockSetApprovedAt).toHaveBeenCalledWith("mission-1");
      expect(mockCreateRun).toHaveBeenCalled();
      expect(result.text).toBe("Starting mission...");
      expect(result.missionStatus).toBe("running");
    });

    it("throws if mission not found", async () => {
      mockGetMission.mockResolvedValueOnce(null);
      await expect(startMission("nonexistent")).rejects.toThrow("not found");
    });

    it("throws if mission not ready", async () => {
      mockGetMission.mockResolvedValueOnce({
        id: "mission-1", status: "draft", title: null, goal: null,
        capitalSourceJson: {}, allowedWallets: [], allowedChains: [],
        allowedProtocols: [], riskProfile: null, successCriteriaJson: [],
        stopConditionsJson: [], constraintsJson: {},
        rootSessionId: "s", createdAt: "", updatedAt: "", approvedAt: null,
      });
      await expect(startMission("mission-1")).rejects.toThrow("not ready");
    });
  });

  // ── resumeMissionRun ────────────────────────────────────────

  describe("resumeMissionRun", () => {
    it("resumes run and enters loop", async () => {
      mockGetRun.mockResolvedValueOnce({
        id: "run-1", missionId: "mission-1", sessionId: "session-1",
        loopMode: "restricted", status: "running", iterationCount: 5,
      });
      mockGetMission.mockResolvedValueOnce({
        id: "mission-1", rootSessionId: "session-1", status: "running",
        title: "SOL DCA", goal: "Accumulate", capitalSourceJson: {},
        allowedWallets: ["sol"], allowedChains: ["sol"], allowedProtocols: ["sol"],
        riskProfile: "conservative", successCriteriaJson: [], stopConditionsJson: [],
        constraintsJson: {}, createdAt: "", updatedAt: "", approvedAt: "",
      });
      mockHydrate.mockResolvedValueOnce(makeHydratedSession({
        sessionKind: "mission", missionId: "mission-1", missionRunId: "run-1",
      }));
      mockRunTurnLoop.mockResolvedValueOnce({
        text: "Resumed", toolCallsMade: 1, pendingApprovals: [], stopReason: null,
      });

      const result = await resumeMissionRun("run-1");

      expect(result.text).toBe("Resumed");
      expect(result.missionStatus).toBe("running");
    });

    it("throws if run not found", async () => {
      mockGetRun.mockResolvedValueOnce(null);
      await expect(resumeMissionRun("nonexistent")).rejects.toThrow("not found");
    });
  });
});
