import { describe, expect, it, vi, beforeEach } from "vitest";

const mockResolveProvider = vi.fn();
const mockAddEngineMessage = vi.fn();
const mockHydrate = vi.fn();
const mockRunTurnLoop = vi.fn();
const mockGetMission = vi.fn();
const mockSetMissionStatus = vi.fn();
const mockSetApprovedAt = vi.fn();
const mockCreateRun = vi.fn();
const mockGetActiveRun = vi.fn();

vi.mock("@vex-agent/inference/registry.js", () => ({
  resolveProvider: () => mockResolveProvider(),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addEngineMessage: (...args: unknown[]) => mockAddEngineMessage(...args),
}));

vi.mock("../../../../vex-agent/engine/core/hydrate.js", () => ({
  hydrateEngineSession: (...args: unknown[]) => mockHydrate(...args),
}));

vi.mock("../../../../vex-agent/engine/core/turn-loop.js", () => ({
  runTurnLoop: (...args: unknown[]) => mockRunTurnLoop(...args),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getMission: (...args: unknown[]) => mockGetMission(...args),
  setStatus: (...args: unknown[]) => mockSetMissionStatus(...args),
  setApprovedAt: (...args: unknown[]) => mockSetApprovedAt(...args),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  createRun: (...args: unknown[]) => mockCreateRun(...args),
  getActiveRun: (...args: unknown[]) => mockGetActiveRun(...args),
  updateStatus: vi.fn(),
}));

vi.mock("@vex-agent/tools/registry.js", () => ({
  getOpenAITools: vi.fn().mockReturnValue([]),
}));

vi.mock("@utils/logger.js", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@vex-agent/tools/protocols/catalog.js", () => ({
  PROTOCOL_TOOLS: [],
  PROTOCOL_NAMESPACE_ALLOWLIST: [],
}));

const { startMission } = await import(
  "../../../../vex-agent/engine/core/runner/mission.js"
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

function makeReadyMission() {
  return {
    id: "mission-1",
    rootSessionId: "session-1",
    status: "ready",
    title: "SOL Sprint",
    goal: "Double mission capital",
    capitalSourceJson: { type: "wallet", amount: "8 USD" },
    allowedWallets: ["solana-wallet"],
    allowedChains: ["solana"],
    allowedProtocols: ["jupiter"],
    riskProfile: "aggressive",
    successCriteriaJson: ["Portfolio reaches 16 USD"],
    stopConditionsJson: ["deadline_reached"],
    constraintsJson: { stopConditionsAccepted: true },
    createdAt: "2026-05-04T00:00:00.000Z",
    updatedAt: "2026-05-04T00:00:00.000Z",
    approvedAt: null,
  };
}

describe("mission activation message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveProvider.mockResolvedValue(makeProvider());
    mockGetMission.mockResolvedValue(makeReadyMission());
    mockGetActiveRun.mockResolvedValue(null);
    mockHydrate.mockResolvedValue({
      context: {
        sessionId: "session-1",
        sessionKind: "mission",
        loopMode: "off",
        missionId: "mission-1",
        missionRunId: null,
        isSubagent: false,
        loadedDocuments: new Map(),
        memoryScopeKey: "session-1",
      },
      messages: [],
      summary: null,
      tokenCount: 0,
    });
    mockRunTurnLoop.mockResolvedValue({
      text: "Scanning now.",
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
    });
  });

  it("writes a mission_started banner before hydrating the first active turn", async () => {
    await startMission("mission-1", "restricted");

    expect(mockAddEngineMessage).toHaveBeenCalledWith(
      "session-1",
      expect.stringContaining("mission_started"),
      expect.objectContaining({
        source: "engine",
        messageType: "mission_started",
        visibility: "internal",
        payload: expect.objectContaining({
          missionId: "mission-1",
          loopMode: "restricted",
        }),
      }),
    );
    expect(mockCreateRun.mock.invocationCallOrder[0]).toBeLessThan(
      mockAddEngineMessage.mock.invocationCallOrder[0],
    );
    expect(mockAddEngineMessage.mock.invocationCallOrder[0]).toBeLessThan(
      mockHydrate.mock.invocationCallOrder[0],
    );
  });
});
