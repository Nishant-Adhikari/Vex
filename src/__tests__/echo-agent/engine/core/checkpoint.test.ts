import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────

const mockCheckpointSession = vi.fn();
const mockArchiveMessages = vi.fn();

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  checkpointSession: (...a: unknown[]) => mockCheckpointSession(...a),
  archiveMessages: (...a: unknown[]) => mockArchiveMessages(...a),
}));

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { shouldCheckpoint, executeCheckpoint } = await import("../../../../echo-agent/engine/core/checkpoint.js");

describe("checkpoint", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── shouldCheckpoint ────────────────────────────────────────

  describe("shouldCheckpoint", () => {
    it("returns false when under threshold", () => {
      expect(shouldCheckpoint(50000, 128000)).toBe(false);
    });

    it("returns true at 90% threshold", () => {
      expect(shouldCheckpoint(115200, 128000)).toBe(true);
    });

    it("returns true when over threshold", () => {
      expect(shouldCheckpoint(130000, 128000)).toBe(true);
    });

    it("returns false for zero context limit", () => {
      expect(shouldCheckpoint(50000, 0)).toBe(false);
    });

    it("returns false for zero token count", () => {
      expect(shouldCheckpoint(0, 128000)).toBe(false);
    });
  });

  // ── executeCheckpoint ───────────────────────────────────────

  describe("executeCheckpoint", () => {
    it("summarizes and checkpoints", async () => {
      const mockProvider = {
        chatCompletionSimple: vi.fn().mockResolvedValue({
          content: "Summary: user checked SOL balance (2.5 SOL)",
          usage: { promptTokens: 100, completionTokens: 50 },
        }),
      };

      const messages = [
        { role: "user" as const, content: "Check my SOL balance", timestamp: "2026-03-29T10:00:00Z" },
        { role: "assistant" as const, content: "Your SOL balance is 2.5 SOL", timestamp: "2026-03-29T10:00:01Z" },
      ];

      const summary = await executeCheckpoint(
        "session-1", messages, mockProvider as any, {} as any,
      );

      expect(summary).toBe("Summary: user checked SOL balance (2.5 SOL)");
      expect(mockCheckpointSession).toHaveBeenCalledWith("session-1", summary);
      expect(mockArchiveMessages).toHaveBeenCalledWith("session-1");
    });

    it("includes message content in compaction prompt", async () => {
      const mockProvider = {
        chatCompletionSimple: vi.fn().mockResolvedValue({
          content: "Summary", usage: { promptTokens: 100, completionTokens: 50 },
        }),
      };

      const messages = [
        { role: "user" as const, content: "Bridge USDC to Arbitrum", timestamp: "2026-03-29T10:00:00Z" },
      ];

      await executeCheckpoint("session-1", messages, mockProvider as any, {} as any);

      const [call] = mockProvider.chatCompletionSimple.mock.calls;
      const systemMsg = call[0][0].content;
      expect(systemMsg).toContain("Bridge USDC to Arbitrum");
    });
  });
});
