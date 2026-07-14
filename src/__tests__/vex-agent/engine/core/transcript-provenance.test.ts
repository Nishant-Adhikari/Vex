/**
 * Transcript provenance — `saveAssistantMessage`'s `systemOriginated` stamp.
 *
 * WP-G requirement: the synthesized `wallet_send_confirm` follow-up call
 * (`dispatchPreparedActionFollowUp`) must be persisted with a marker an
 * auditor reading `messages` directly can use to tell it apart from real
 * model output, even though it shares the `assistant` role + tool_calls
 * shape the provider transcript format requires. This pins the persistence
 * boundary itself, one layer below the engine orchestration covered by
 * `prepared-action-follow-up.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const appendMessage = vi.fn().mockResolvedValue({ id: 1 });

vi.mock("@vex-agent/engine/events/index.js", () => ({
  appendMessage: (...args: unknown[]) => appendMessage(...args),
  streamDeltaBus: { emit: vi.fn() },
  toStreamDeltaEvent: vi.fn(),
}));

const { saveAssistantMessage } = await import(
  "../../../../vex-agent/engine/core/turn.js"
);

beforeEach(() => {
  appendMessage.mockClear();
});

const SESSION_ID = "session-1";

describe("saveAssistantMessage provenance stamp", () => {
  it("stamps a genuine model-authored turn as source:assistant, messageType:chat", async () => {
    await saveAssistantMessage(SESSION_ID, "hello", null);
    const metadata = appendMessage.mock.calls[0]![2];
    expect(metadata).toMatchObject({ source: "assistant", messageType: "chat" });
  });

  it("stamps the synthesized prepared-action follow-up as source:engine with a distinct messageType", async () => {
    await saveAssistantMessage(
      SESSION_ID,
      null,
      [{ id: "prepared-follow-up-1", name: "wallet_send_confirm", arguments: { network: "solana", intentId: "intent-1" } }],
      { systemOriginated: true },
    );
    const metadata = appendMessage.mock.calls[0]![2];
    expect(metadata.source).toBe("engine");
    expect(metadata.source).not.toBe("assistant");
    expect(metadata.messageType).toBe("prepared_action_follow_up");
    expect(metadata.messageType).not.toBe("chat");
  });

  it("keeps the stopped-turn stamp (source:assistant, messageType:chat_stopped) unaffected by the new flag", async () => {
    await saveAssistantMessage(SESSION_ID, "partial", null, { stopped: true });
    const metadata = appendMessage.mock.calls[0]![2];
    expect(metadata).toMatchObject({
      source: "assistant",
      messageType: "chat_stopped",
    });
  });
});
