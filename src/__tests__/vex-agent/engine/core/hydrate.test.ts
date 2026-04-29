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

const { hydrateEngineSession } = await import("../../../../vex-agent/engine/core/hydrate.js");

describe("hydrate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for nonexistent session", async () => {
    mockGetSession.mockResolvedValueOnce(null);
    const result = await hydrateEngineSession("nonexistent");
    expect(result).toBeNull();
  });

  it("hydrates a basic chat session", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-1", scope: "chat", summary: null,
      compacted: false, messageCount: 3, tokenCount: 1500,
    });
    mockGetLiveMessages.mockResolvedValueOnce([
      { role: "user", content: "Hello", timestamp: "2026-03-29T10:00:00Z" },
    ]);

    const result = await hydrateEngineSession("session-1");
    expect(result).not.toBeNull();
    expect(result!.context.sessionId).toBe("session-1");
    expect(result!.context.sessionKind).toBe("chat");
    expect(result!.context.loopMode).toBe("off");
    expect(result!.context.isSubagent).toBe(false);
    expect(result!.messages).toHaveLength(1);
    expect(result!.tokenCount).toBe(1500);
  });

  it("hydrates a mission session with active run", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-1", scope: "chat", summary: "Previous summary",
      compacted: true, messageCount: 5, tokenCount: 5000,
    });
    mockGetMissionBySession.mockResolvedValueOnce({
      id: "mission-1", rootSessionId: "session-1", status: "running",
    });
    mockGetActiveRun.mockResolvedValueOnce({
      id: "run-1", missionId: "mission-1", sessionId: "session-1",
      loopMode: "restricted", status: "running",
    });

    const result = await hydrateEngineSession("session-1");
    expect(result!.context.sessionKind).toBe("mission");
    expect(result!.context.missionId).toBe("mission-1");
    expect(result!.context.missionRunId).toBe("run-1");
    expect(result!.context.loopMode).toBe("restricted");
    expect(result!.summary).toBe("Previous summary");
  });

  it("detects subagent sessions via session_links", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-child", scope: "chat", summary: null,
      compacted: false, messageCount: 0, tokenCount: 0,
    });
    mockGetParentSession.mockResolvedValueOnce({ parentSessionId: "session-parent" });

    const result = await hydrateEngineSession("session-child");
    expect(result!.context.isSubagent).toBe(true);
  });

  it("defaults loopMode to off when no active run", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-1", scope: "chat", summary: null,
      compacted: false, messageCount: 0, tokenCount: 0,
    });
    mockGetMissionBySession.mockResolvedValueOnce({
      id: "mission-1", rootSessionId: "session-1", status: "draft",
    });
    // No active run
    mockGetActiveRun.mockResolvedValueOnce(null);

    const result = await hydrateEngineSession("session-1");
    expect(result!.context.loopMode).toBe("off");
    expect(result!.context.missionRunId).toBeNull();
  });

  it("provides empty loadedDocuments", async () => {
    mockGetSession.mockResolvedValueOnce({
      id: "session-1", scope: "chat", summary: null,
      compacted: false, messageCount: 0, tokenCount: 0,
    });

    const result = await hydrateEngineSession("session-1");
    expect(result!.context.loadedDocuments.size).toBe(0);
  });
});
