import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockGetSession = vi.fn();
const mockGetLiveMessages = vi.fn().mockResolvedValue([]);
const mockGetMissionBySession = vi.fn().mockResolvedValue(null);
const mockGetActiveRun = vi.fn().mockResolvedValue(null);
const mockGetParentSession = vi.fn().mockResolvedValue(null);

vi.mock("@vex-agent/db/repos/sessions.js", () => ({
  getSession: (...a: unknown[]) => mockGetSession(...a),
  updateTokenCount: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  getLiveMessages: (...a: unknown[]) => mockGetLiveMessages(...a),
  addMessage: vi.fn(),
  addEngineMessage: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/missions.js", () => ({
  getActiveMission: (...a: unknown[]) => mockGetMissionBySession(...a),
  getMissionBySession: (...a: unknown[]) => mockGetMissionBySession(...a),
  getMission: vi.fn(),
}));

vi.mock("@vex-agent/db/repos/mission-runs.js", () => ({
  getActiveRun: (...a: unknown[]) => mockGetActiveRun(...a),
}));

vi.mock("@vex-agent/db/repos/session-links.js", () => ({
  getParentSession: (...a: unknown[]) => mockGetParentSession(...a),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { hydrateEngineSession, resolveMissionChain } = await import("../../../../vex-agent/engine/core/hydrate.js");

describe("hydrate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for nonexistent session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const result = await hydrateEngineSession("nonexistent");
    expect(result).toBeNull();
  });

  it("hydrates a basic agent session", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-1", scope: "chat", mode: "agent", permission: "restricted",
      summary: null,
      compacted: false, messageCount: 3, tokenCount: 1500,
    });
    mockGetLiveMessages.mockResolvedValueOnce([
      { role: "user", content: "Hello", timestamp: "2026-03-29T10:00:00Z" },
    ]);

    const result = await hydrateEngineSession("session-1");
    expect(result).not.toBeNull();
    expect(result!.context.sessionId).toBe("session-1");
    expect(result!.context.sessionKind).toBe("agent");
    expect(result!.context.sessionPermission).toBe("restricted");
    expect(result!.context.isSubagent).toBe(false);
    expect(result!.messages).toHaveLength(1);
    expect(result!.tokenCount).toBe(1500);
  });

  it("hydrates a mission session with active run", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-1", scope: "chat", mode: "mission", permission: "restricted",
      summary: "Previous summary",
      compacted: true, messageCount: 5, tokenCount: 5000,
      startedAt: "2026-05-03T08:01:02.000Z",
    });
    mockGetMissionBySession.mockResolvedValueOnce({
      id: "mission-1", rootSessionId: "session-1", status: "running",
      constraintsJson: { deadline: "2026-05-03T14:10:00.000Z" },
    });
    mockGetActiveRun.mockResolvedValueOnce({
      id: "run-1", missionId: "mission-1", sessionId: "session-1",
      status: "running",
      startedAt: "2026-05-03T08:10:00.000Z",
    });

    const result = await hydrateEngineSession("session-1");
    expect(result!.context.sessionKind).toBe("mission");
    expect(result!.context.missionId).toBe("mission-1");
    expect(result!.context.missionRunId).toBe("run-1");
    expect(result!.context.sessionPermission).toBe("restricted");
    expect(result!.context.sessionStartedAt).toBe("2026-05-03T08:01:02.000Z");
    expect(result!.context.missionRunStartedAt).toBe("2026-05-03T08:10:00.000Z");
    expect(result!.context.missionDeadline).toBe("2026-05-03T14:10:00.000Z");
    expect(result!.summary).toBe("Previous summary");
  });

  it("detects subagent sessions via session_links", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-child", scope: "chat", mode: "agent", permission: "restricted",
      summary: null,
      compacted: false, messageCount: 0, tokenCount: 0,
    });
    mockGetParentSession.mockResolvedValueOnce({ parentSessionId: "session-parent" });

    const result = await hydrateEngineSession("session-child");
    expect(result!.context.isSubagent).toBe(true);
  });

  it("falls back to mission setup (no active run) when mission exists in draft", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-1", scope: "chat", mode: "mission", permission: "restricted",
      summary: null,
      compacted: false, messageCount: 0, tokenCount: 0,
    });
    mockGetMissionBySession.mockResolvedValueOnce({
      id: "mission-1", rootSessionId: "session-1", status: "draft",
    });
    // No active run
    mockGetActiveRun.mockResolvedValueOnce(null);

    const result = await hydrateEngineSession("session-1");
    expect(result!.context.sessionKind).toBe("mission");
    expect(result!.context.missionRunId).toBeNull();
  });

  it("provides empty loadedDocuments", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-1", scope: "chat", mode: "agent", permission: "restricted",
      summary: null,
      compacted: false, messageCount: 0, tokenCount: 0,
    });

    const result = await hydrateEngineSession("session-1");
    expect(result!.context.loadedDocuments.size).toBe(0);
  });
});

describe("resolveMissionChain (discovery chain scope)", () => {
  const mission = (allowedChains: string[]) =>
    ({ allowedChains } as unknown as Parameters<typeof resolveMissionChain>[0]);
  const run = (frozenAllowedChains: string[] | undefined) =>
    ({
      contractSnapshotJson: frozenAllowedChains
        ? { frozenMission: { draft: { allowedChains: frozenAllowedChains } } }
        : {},
    } as unknown as Parameters<typeof resolveMissionChain>[1]);

  it("returns null when there is no mission and no run", () => {
    expect(resolveMissionChain(null, null)).toBeNull();
  });

  it("resolves a robinhood alias/id/name from the frozen snapshot to the dexscreener slug", () => {
    expect(resolveMissionChain(mission(["ignored"]), run(["robinhood"]))).toBe("robinhood");
    expect(resolveMissionChain(mission(["ignored"]), run(["4663"]))).toBe("robinhood");
    expect(resolveMissionChain(mission(["ignored"]), run(["Robinhood Chain"]))).toBe("robinhood");
  });

  it("normalizes common non-local aliases / names / numeric ids to their DexScreener slug", () => {
    expect(resolveMissionChain(mission(["eth"]), null)).toBe("ethereum");
    expect(resolveMissionChain(mission(["1"]), null)).toBe("ethereum");
    expect(resolveMissionChain(mission(["Ethereum"]), null)).toBe("ethereum");
    expect(resolveMissionChain(mission(["8453"]), null)).toBe("base");
    expect(resolveMissionChain(mission(["SOLANA"]), null)).toBe("solana");
    expect(resolveMissionChain(mission(["arb"]), null)).toBe("arbitrum");
  });

  it("prefers the frozen snapshot over the live mission row", () => {
    expect(resolveMissionChain(mission(["base"]), run(["robinhood"]))).toBe("robinhood");
  });

  it("falls back to the live mission row when the snapshot has no chain", () => {
    expect(resolveMissionChain(mission(["robinhood"]), run(undefined))).toBe("robinhood");
    expect(resolveMissionChain(mission(["robinhood"]), null)).toBe("robinhood");
  });

  it("does NOT scope a multi-chain contract (spans all allowed chains → null)", () => {
    expect(resolveMissionChain(mission(["ethereum", "base"]), null)).toBeNull();
    expect(resolveMissionChain(mission(["x"]), run(["robinhood", "base"]))).toBeNull();
  });

  it("returns null for a chain it cannot confidently resolve (unscoped, never a guessed filter)", () => {
    expect(resolveMissionChain(mission(["zzz-unknown-chain"]), null)).toBeNull();
  });

  it("returns null for an empty allowed-chains list", () => {
    expect(resolveMissionChain(mission([]), null)).toBeNull();
  });
});
