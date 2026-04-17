/**
 * Unit tests for `selectArchivePrefix` — pure helper, no DB.
 *
 * The helper decides where to cut the live-message array for partial archive.
 * The only invariant the caller cares about is that an `assistant.tool_calls`
 * ↔ `role:'tool'` pair never gets split across the cutoff.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@echo-agent/db/client.js", () => ({
  execute: vi.fn(),
  query: vi.fn().mockResolvedValue([]),
  queryOne: vi.fn().mockResolvedValue(null),
}));

const { selectArchivePrefix } = await import("../../../../echo-agent/db/repos/messages.js");

type M = {
  id: number;
  role: "user" | "assistant" | "tool" | "system";
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; command: string; args: Record<string, unknown> }>;
  timestamp: string;
};

function msg(
  id: number,
  role: M["role"],
  content: string,
  extras: { toolCallId?: string; toolCalls?: M["toolCalls"] } = {},
): M {
  return {
    id,
    role,
    content,
    toolCallId: extras.toolCallId,
    toolCalls: extras.toolCalls,
    timestamp: `2026-04-01T00:00:${String(id).padStart(2, "0")}Z`,
  };
}

describe("selectArchivePrefix", () => {
  it("returns empty plan for empty input", () => {
    const plan = selectArchivePrefix([], 5);
    expect(plan.prefix).toEqual([]);
    expect(plan.tail).toEqual([]);
    expect(plan.cutoffMessageId).toBeNull();
  });

  it("splits cleanly when the boundary lands on a user or assistant turn", () => {
    const messages = [
      msg(1, "user", "a"),
      msg(2, "assistant", "b"),
      msg(3, "user", "c"),
      msg(4, "assistant", "d"),
      msg(5, "user", "e"),
      msg(6, "assistant", "f"),
    ];
    const plan = selectArchivePrefix(messages, 3);
    expect(plan.prefix.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(plan.tail.map((m) => m.id)).toEqual([4, 5, 6]);
    expect(plan.cutoffMessageId).toBe(3);
  });

  it("walks back across tool rows so assistant/tool pairs stay together", () => {
    const messages = [
      msg(1, "user", "start"),
      msg(2, "assistant", "", {
        toolCalls: [
          { id: "a", command: "foo", args: {} },
          { id: "b", command: "foo", args: {} },
        ],
      }),
      msg(3, "tool", "result-a", { toolCallId: "a" }),
      msg(4, "tool", "result-b", { toolCallId: "b" }),
      msg(5, "assistant", "done"),
    ];
    // tailWindow=3 would start at idx 2 (tool). Must walk back to idx 1 (assistant).
    const plan = selectArchivePrefix(messages, 3);
    expect(plan.prefix.map((m) => m.id)).toEqual([1]);
    expect(plan.tail.map((m) => m.id)).toEqual([2, 3, 4, 5]);
    expect(plan.cutoffMessageId).toBe(1);
  });

  it("treats engine system messages as normal tail entries", () => {
    const messages = [
      msg(1, "user", "start"),
      msg(2, "assistant", "a"),
      msg(3, "system", "[Engine: continue]"),
      msg(4, "assistant", "b"),
      msg(5, "user", "next"),
    ];
    const plan = selectArchivePrefix(messages, 2);
    expect(plan.prefix.map((m) => m.id)).toEqual([1, 2, 3]);
    expect(plan.tail.map((m) => m.id)).toEqual([4, 5]);
    expect(plan.cutoffMessageId).toBe(3);
  });

  it("returns empty prefix when every live message is swallowed by the tail window", () => {
    const messages = [msg(1, "user", "hi"), msg(2, "assistant", "hello")];
    const plan = selectArchivePrefix(messages, 10);
    expect(plan.prefix).toEqual([]);
    expect(plan.tail.map((m) => m.id)).toEqual([1, 2]);
    expect(plan.cutoffMessageId).toBeNull();
  });

  it("returns empty prefix when the entire tail backs up onto the first message", () => {
    const messages = [
      msg(1, "assistant", "", {
        toolCalls: [{ id: "only", command: "foo", args: {} }],
      }),
      msg(2, "tool", "r", { toolCallId: "only" }),
    ];
    const plan = selectArchivePrefix(messages, 1);
    expect(plan.prefix).toEqual([]);
    expect(plan.tail.map((m) => m.id)).toEqual([1, 2]);
    expect(plan.cutoffMessageId).toBeNull();
  });
});
