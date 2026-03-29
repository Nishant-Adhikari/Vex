import { describe, it, expect, vi, beforeEach } from "vitest";

const mockInsert = vi.fn().mockResolvedValue(undefined);
const mockGetById = vi.fn().mockResolvedValue(null);
const mockGetActive = vi.fn().mockResolvedValue([]);
const mockGetRecent = vi.fn().mockResolvedValue([]);
const mockUpdateStatus = vi.fn().mockResolvedValue(undefined);

vi.mock("@echo-agent/db/repos/subagents.js", () => ({
  insert: (...args: unknown[]) => mockInsert(...args),
  getById: (...args: unknown[]) => mockGetById(...args),
  getActive: (...args: unknown[]) => mockGetActive(...args),
  getRecent: (...args: unknown[]) => mockGetRecent(...args),
  updateStatus: (...args: unknown[]) => mockUpdateStatus(...args),
}));

const mockCreateSession = vi.fn().mockResolvedValue(undefined);
const mockSetScope = vi.fn().mockResolvedValue(undefined);

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  setScope: (...args: unknown[]) => mockSetScope(...args),
}));

const mockLinkSessions = vi.fn().mockResolvedValue({ id: 1 });

vi.mock("@echo-agent/db/repos/session-links.js", () => ({
  linkSessions: (...args: unknown[]) => mockLinkSessions(...args),
}));

// Mock engine subagent runner — returns immediately with result
vi.mock("@echo-agent/engine/subagents/runner.js", () => ({
  runSubagentEngine: vi.fn().mockResolvedValue({
    subagentId: "subagent-test",
    sessionId: "session-test",
    output: "Engine subagent completed",
    toolCallsMade: 0,
    success: true,
  }),
}));

const { handleSubagentSpawn, handleSubagentStatus, handleSubagentStop } = await import(
  "../../../../echo-agent/tools/internal/subagent.js"
);

const baseContext = {
  sessionId: "test-session",
  loadedDocuments: new Map<string, string>(),
  loopMode: "off" as const,
  approved: false,
};

describe("subagent handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── subagent_spawn ────────────────────────────────────────────────

  describe("handleSubagentSpawn", () => {
    it("fails without name", async () => {
      const result = await handleSubagentSpawn({ task: "do something" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("name");
    });

    it("fails without task", async () => {
      const result = await handleSubagentSpawn({ name: "EchoTest" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("task");
    });

    it("spawns subagent and returns id", async () => {
      const result = await handleSubagentSpawn(
        { name: "EchoResearch", task: "research SOL ecosystem" },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.id).toMatch(/^subagent-/);
      expect(parsed.name).toBe("EchoResearch");
      expect(parsed.allowTrades).toBe(false);
      expect(parsed.maxIterations).toBe(25);
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it("creates child session on spawn", async () => {
      await handleSubagentSpawn(
        { name: "EchoSession", task: "test" },
        baseContext,
      );
      expect(mockCreateSession).toHaveBeenCalledTimes(1);
      const sessionId = mockCreateSession.mock.calls[0][0];
      expect(sessionId).toMatch(/^session-/);
    });

    it("sets child session scope to subagent", async () => {
      await handleSubagentSpawn(
        { name: "EchoScope", task: "test" },
        baseContext,
      );
      expect(mockSetScope).toHaveBeenCalledTimes(1);
      expect(mockSetScope.mock.calls[0][1]).toBe("subagent");
    });

    it("creates session_links with correct parent, child, and subagentId", async () => {
      const result = await handleSubagentSpawn(
        { name: "EchoLink", task: "test" },
        baseContext,
      );
      const parsed = JSON.parse(result.output);

      expect(mockLinkSessions).toHaveBeenCalledTimes(1);
      const [parentId, childId, relationType, subagentId] = mockLinkSessions.mock.calls[0];
      expect(parentId).toBe("test-session");
      expect(childId).toMatch(/^session-/);
      expect(relationType).toBe("subagent");
      expect(subagentId).toBe(parsed.id);
    });

    it("subagent finalizes via engine runner and does not stay zombie", async () => {
      await handleSubagentSpawn(
        { name: "EchoFinalize", task: "test" },
        baseContext,
      );
      // runSubagent is async — give engine runner mock time to resolve
      await new Promise(r => setTimeout(r, 100));

      expect(mockUpdateStatus).toHaveBeenCalled();
      const completedCall = mockUpdateStatus.mock.calls.find(
        (c: unknown[]) => c[1] === "completed",
      );
      expect(completedCall).toBeTruthy();
    });

    it("respects allow_trades flag", async () => {
      const result = await handleSubagentSpawn(
        { name: "EchoTrader", task: "trade SOL", allow_trades: true },
        baseContext,
      );
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.allowTrades).toBe(true);
    });

    it("respects custom max_iterations", async () => {
      await handleSubagentSpawn(
        { name: "EchoLong", task: "deep research", max_iterations: 50 },
        baseContext,
      );
      const insertArg = mockInsert.mock.calls[0][0];
      expect(insertArg.maxIterations).toBe(50);
    });

    it("rejects duplicate active name", async () => {
      await handleSubagentSpawn({ name: "EchoDup", task: "first" }, baseContext);
      const result = await handleSubagentSpawn({ name: "EchoDup", task: "second" }, baseContext);
      expect(result.success).toBe(false);
      expect(result.output).toContain("already running");
    });
  });

  // ── subagent_status ───────────────────────────────────────────────

  describe("handleSubagentStatus", () => {
    it("returns message when no subagents", async () => {
      const result = await handleSubagentStatus({}, baseContext);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.message).toContain("No active");
    });

    it("returns specific subagent by id", async () => {
      mockGetById.mockResolvedValueOnce({
        id: "subagent-123", name: "EchoTest", task: "test", status: "running",
        allowTrades: false, startedAt: new Date().toISOString(), endedAt: null,
        result: null, error: null, tokenCost: 0, iterations: 5, maxIterations: 25,
      });

      const result = await handleSubagentStatus({ id: "subagent-123" }, baseContext);
      expect(result.success).toBe(true);
      const parsed = JSON.parse(result.output);
      expect(parsed.id).toBe("subagent-123");
    });

    it("merges active and recent deduped", async () => {
      mockGetActive.mockResolvedValueOnce([
        { id: "sub-1", name: "A", task: "t", status: "running", allowTrades: false, startedAt: new Date().toISOString(), endedAt: null, result: null, error: null, tokenCost: 0, iterations: 3, maxIterations: 25 },
      ]);
      mockGetRecent.mockResolvedValueOnce([
        { id: "sub-1", name: "A", task: "t", status: "running", allowTrades: false, startedAt: new Date().toISOString(), endedAt: null, result: null, error: null, tokenCost: 0, iterations: 3, maxIterations: 25 },
        { id: "sub-2", name: "B", task: "t2", status: "completed", allowTrades: false, startedAt: new Date().toISOString(), endedAt: new Date().toISOString(), result: "ok", error: null, tokenCost: 0, iterations: 10, maxIterations: 25 },
      ]);

      const result = await handleSubagentStatus({}, baseContext);
      const parsed = JSON.parse(result.output);
      expect(parsed.count).toBe(2);
    });
  });

  // ── subagent_stop ─────────────────────────────────────────────────

  describe("handleSubagentStop", () => {
    it("fails without id", async () => {
      const result = await handleSubagentStop({}, baseContext);
      expect(result.success).toBe(false);
    });

    it("stops and updates status", async () => {
      const result = await handleSubagentStop({ id: "subagent-123" }, baseContext);
      expect(result.success).toBe(true);
      expect(mockUpdateStatus).toHaveBeenCalledWith("subagent-123", "stopped");
    });
  });
});
