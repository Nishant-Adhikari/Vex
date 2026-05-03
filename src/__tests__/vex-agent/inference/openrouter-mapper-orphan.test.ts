/**
 * OpenRouter mapper safety belt — defends against orphan tool_calls at the
 * SDK boundary even if a caller bypasses the engine layer.
 */

import { describe, it, expect } from "vitest";
import { mapMessages, synthesizeMissingToolResults } from "../../../vex-agent/inference/openrouter/mappers.js";
import type { ProviderMessage } from "../../../vex-agent/inference/types.js";

describe("mapMessages — orphan tool_calls safety belt", () => {
  it("synthesises placeholders when last assistant has tool_calls but no follow-ups", () => {
    const input: ProviderMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", command: "noop", args: {} }],
      },
    ];
    const out = mapMessages(input);
    expect(out.length).toBe(3);
    expect(out[2].role).toBe("tool");
    expect(out[2]).toMatchObject({ role: "tool", toolCallId: "c1" });
  });

  it("is a no-op when matching tool messages already exist", () => {
    const input: ProviderMessage[] = [
      { role: "user", content: "go" },
      {
        role: "assistant",
        content: "",
        toolCalls: [{ id: "c1", command: "noop", args: {} }],
      },
      { role: "tool", content: "result", toolCallId: "c1" },
    ];
    const out = mapMessages(input);
    expect(out.length).toBe(3);
    // Matching tool result preserved verbatim, no placeholder added.
    expect(out[2]).toEqual({ role: "tool", content: "result", toolCallId: "c1" });
  });

  it("preserves assistant.content when both content and tool_calls are present", () => {
    const input: ProviderMessage[] = [
      {
        role: "assistant",
        content: "thinking...",
        toolCalls: [{ id: "c1", command: "noop", args: {} }],
      },
    ];
    const out = mapMessages(input);
    expect(out.length).toBe(2);
    expect(out[0]).toMatchObject({ role: "assistant", content: "thinking..." });
    expect(out[1]).toMatchObject({ role: "tool", toolCallId: "c1" });
  });

  it("leaves normal text/tool sequences unchanged through the safety belt", () => {
    const input: ProviderMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ];
    const out = mapMessages(input);
    expect(out).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
    ]);
  });
});

describe("synthesizeMissingToolResults", () => {
  it("inserts adjacent placeholders, not at the tail, when other rows follow", () => {
    const input = [
      { role: "user" as const, content: "go" },
      {
        role: "assistant" as const,
        content: undefined,
        toolCalls: [
          {
            id: "c1",
            type: "function" as const,
            function: { name: "noop", arguments: "{}" },
          },
        ],
      },
      { role: "user" as const, content: "next" },
    ];
    const out = synthesizeMissingToolResults(input);
    expect(out.length).toBe(4);
    expect(out[2]).toMatchObject({ role: "tool", toolCallId: "c1" });
    // The "user" message is still last — placeholder didn't get appended.
    expect(out[3]).toMatchObject({ role: "user", content: "next" });
  });
});
