import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSendMessage = vi.fn();
const mockGetMessagesByDirection = vi.fn().mockResolvedValue([]);

vi.mock("@vex-agent/db/repos/subagent-messages.js", () => ({
  sendMessage: (...a: unknown[]) => mockSendMessage(...a),
  getMessagesByDirection: (...a: unknown[]) => mockGetMessagesByDirection(...a),
}));

vi.mock("@vex-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { relayToParent, relayToChild, getMessagesToParent, getMessagesToChild } = await import(
  "../../../../vex-agent/engine/subagents/relay.js"
);

describe("subagent relay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("relayToParent", () => {
    it("sends message with to_parent direction", async () => {
      await relayToParent("subagent-1", "Research complete");
      expect(mockSendMessage).toHaveBeenCalledWith("subagent-1", "to_parent", "Research complete");
    });
  });

  describe("relayToChild", () => {
    it("sends message with to_child direction", async () => {
      await relayToChild("subagent-1", "New task: check prices");
      expect(mockSendMessage).toHaveBeenCalledWith("subagent-1", "to_child", "New task: check prices");
    });
  });

  describe("getMessagesToParent", () => {
    it("fetches messages with to_parent direction", async () => {
      mockGetMessagesByDirection.mockResolvedValueOnce([
        { id: 1, content: "Done", direction: "to_parent" },
      ]);
      const msgs = await getMessagesToParent("subagent-1");
      expect(mockGetMessagesByDirection).toHaveBeenCalledWith("subagent-1", "to_parent");
      expect(msgs).toHaveLength(1);
    });
  });

  describe("getMessagesToChild", () => {
    it("fetches messages with to_child direction", async () => {
      await getMessagesToChild("subagent-1");
      expect(mockGetMessagesByDirection).toHaveBeenCalledWith("subagent-1", "to_child");
    });
  });
});
