import { describe, it, expect, vi, beforeEach } from "vitest";

const mockExecute = vi.fn().mockResolvedValue(0);
const mockQuery = vi.fn().mockResolvedValue([]);

vi.mock("@vex-agent/db/client.js", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  query: (...args: unknown[]) => mockQuery(...args),
}));

const { getLiveMessages } = await import("../../../../vex-agent/db/repos/messages.js");

describe("messages repo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes database Date timestamps to ISO strings", async () => {
    mockQuery.mockResolvedValueOnce([
      {
        id: 1,
        role: "tool",
        content: "ok",
        tool_call_id: "call-1",
        tool_calls: null,
        created_at: new Date("2026-05-02T15:44:20.269Z"),
        source: null,
        message_type: null,
        visibility: null,
        origin_session_id: null,
        subagent_id: null,
        metadata: { success: true },
      },
    ]);

    const messages = await getLiveMessages("session-1");

    expect(messages[0]?.timestamp).toBe("2026-05-02T15:44:20.269Z");
  });
});
