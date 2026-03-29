import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(0);

vi.mock("@echo-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { addMessage, addEngineMessage } = await import(
  "../../../../echo-agent/db/repos/messages.js"
);

describe("messages extended (engine metadata)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── addMessage backwards compatibility ──────────────────────

  describe("addMessage without metadata", () => {
    it("inserts with null metadata fields", async () => {
      await addMessage("session-1", {
        role: "user",
        content: "Hello",
        timestamp: "2026-03-28T10:00:00Z",
      });

      expect(mockExecute).toHaveBeenCalledTimes(2); // insert + message_count
      const [sql, params] = mockExecute.mock.calls[0];
      expect(sql).toContain("source");
      expect(sql).toContain("message_type");
      expect(sql).toContain("visibility");
      // Metadata params should be null (positions 7-11)
      expect(params[6]).toBeNull(); // source
      expect(params[7]).toBeNull(); // messageType
      expect(params[8]).toBeNull(); // visibility
      expect(params[9]).toBeNull(); // originSessionId
      expect(params[10]).toBeNull(); // subagentId
    });
  });

  // ── addMessage with metadata ────────────────────────────────

  describe("addMessage with metadata", () => {
    it("inserts with engine metadata", async () => {
      await addMessage(
        "session-1",
        { role: "assistant", content: "Processing...", timestamp: "2026-03-28T10:00:00Z" },
        { source: "engine", messageType: "continue", visibility: "internal" },
      );

      const [, params] = mockExecute.mock.calls[0];
      expect(params[6]).toBe("engine");
      expect(params[7]).toBe("continue");
      expect(params[8]).toBe("internal");
    });

    it("inserts with subagent metadata", async () => {
      await addMessage(
        "session-1",
        { role: "assistant", content: "Research complete", timestamp: "2026-03-28T10:00:00Z" },
        { source: "subagent", messageType: "subagent_relay", subagentId: "subagent-1", originSessionId: "session-child" },
      );

      const [, params] = mockExecute.mock.calls[0];
      expect(params[6]).toBe("subagent");
      expect(params[7]).toBe("subagent_relay");
      expect(params[9]).toBe("session-child");
      expect(params[10]).toBe("subagent-1");
    });

    it("handles partial metadata", async () => {
      await addMessage(
        "session-1",
        { role: "tool", content: "{}", toolCallId: "call-1", timestamp: "2026-03-28T10:00:00Z" },
        { source: "tool", messageType: "tool_result" },
      );

      const [, params] = mockExecute.mock.calls[0];
      expect(params[6]).toBe("tool");
      expect(params[7]).toBe("tool_result");
      expect(params[8]).toBeNull(); // visibility not specified
      expect(params[9]).toBeNull();
      expect(params[10]).toBeNull();
    });
  });

  // ── addEngineMessage ────────────────────────────────────────

  describe("addEngineMessage", () => {
    it("creates system message with metadata by default", async () => {
      await addEngineMessage("session-1", "[Continue mission]", {
        source: "engine",
        messageType: "continue",
        visibility: "internal",
      });

      const [, params] = mockExecute.mock.calls[0];
      expect(params[1]).toBe("system"); // default role
      expect(params[2]).toBe("[Continue mission]");
      expect(params[6]).toBe("engine");
      expect(params[7]).toBe("continue");
      expect(params[8]).toBe("internal");
    });

    it("respects custom role", async () => {
      await addEngineMessage("session-1", "Checkpoint saved", {
        role: "assistant",
        source: "engine",
        messageType: "checkpoint",
      });

      const [, params] = mockExecute.mock.calls[0];
      expect(params[1]).toBe("assistant");
    });

    it("generates timestamp automatically", async () => {
      const before = Date.now();
      await addEngineMessage("session-1", "Test", {
        source: "engine",
        messageType: "chat",
      });
      const after = Date.now();

      const [, params] = mockExecute.mock.calls[0];
      const ts = new Date(params[5] as string).getTime();
      expect(ts).toBeGreaterThanOrEqual(before);
      expect(ts).toBeLessThanOrEqual(after);
    });
  });

  // ── message_count still incremented ─────────────────────────

  describe("message_count", () => {
    it("increments on addMessage", async () => {
      await addMessage("session-1", {
        role: "user", content: "test", timestamp: "2026-03-28T10:00:00Z",
      });
      const [sql] = mockExecute.mock.calls[1];
      expect(sql).toContain("message_count = message_count + 1");
    });

    it("increments on addEngineMessage", async () => {
      await addEngineMessage("session-1", "test", { source: "engine", messageType: "chat" });
      const [sql] = mockExecute.mock.calls[1];
      expect(sql).toContain("message_count = message_count + 1");
    });
  });
});
