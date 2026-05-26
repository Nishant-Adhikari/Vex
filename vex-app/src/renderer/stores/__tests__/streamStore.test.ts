import { beforeEach, describe, expect, it } from "vitest";

import { reducePreview, useStreamStore } from "../streamStore.js";
import type { StreamDeltaEvent } from "@shared/schemas/stream.js";

const SESSION = "00000000-0000-4000-8000-0000000000aa";

function ev(input: {
  readonly streamId?: string;
  readonly delta: StreamDeltaEvent["delta"];
}): StreamDeltaEvent {
  return {
    type: "engine.stream.delta",
    sessionId: SESSION,
    streamId: input.streamId ?? "s1",
    sequence: 0,
    deltaType: input.delta.kind,
    delta: input.delta,
    createdAt: "2026-05-26T10:00:00.000Z",
    correlationId: null,
  };
}

describe("reducePreview", () => {
  it("starts a preview and accumulates text", () => {
    const a = reducePreview(undefined, ev({ delta: { kind: "text", text: "Hel" } }));
    expect(a).toEqual({ streamId: "s1", text: "Hel", phase: "streaming", toolName: null });
    const b = reducePreview(a, ev({ delta: { kind: "text", text: "lo" } }));
    expect(b.text).toBe("Hello");
  });

  it("resets to a fresh preview when the streamId changes", () => {
    const a = reducePreview(undefined, ev({ streamId: "s1", delta: { kind: "text", text: "old" } }));
    const b = reducePreview(a, ev({ streamId: "s2", delta: { kind: "text", text: "new" } }));
    expect(b).toEqual({ streamId: "s2", text: "new", phase: "streaming", toolName: null });
  });

  it("sets toolName on tool_call, defaulting to 'tool' when anonymous", () => {
    const named = reducePreview(
      undefined,
      ev({ delta: { kind: "tool_call", toolCallIndex: 0, toolCallId: "c", toolCallName: "swap" } }),
    );
    expect(named.toolName).toBe("swap");
    const anon = reducePreview(
      undefined,
      ev({ delta: { kind: "tool_call", toolCallIndex: 0, toolCallId: null, toolCallName: null } }),
    );
    expect(anon.toolName).toBe("tool");
  });

  it("marks done and error phases", () => {
    const base = reducePreview(undefined, ev({ delta: { kind: "text", text: "x" } }));
    expect(reducePreview(base, ev({ delta: { kind: "done" } })).phase).toBe("done");
    expect(
      reducePreview(base, ev({ delta: { kind: "error", message: "Stream error", code: null } })).phase,
    ).toBe("error");
  });

  it("keeps the preview unchanged for reasoning/usage deltas", () => {
    const base = reducePreview(undefined, ev({ delta: { kind: "text", text: "hi" } }));
    expect(reducePreview(base, ev({ delta: { kind: "reasoning", text: "think" } }))).toEqual(base);
    expect(
      reducePreview(
        base,
        ev({ delta: { kind: "usage", usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } } }),
      ),
    ).toEqual(base);
  });
});

describe("useStreamStore actions", () => {
  beforeEach(() => useStreamStore.setState({ bySessionId: {} }));

  it("applyDelta writes per session; clear removes only that session", () => {
    const store = useStreamStore.getState();
    store.applyDelta(SESSION, ev({ delta: { kind: "text", text: "hi" } }));
    store.applyDelta("other", ev({ delta: { kind: "text", text: "yo" } }));
    expect(useStreamStore.getState().bySessionId[SESSION]?.text).toBe("hi");

    useStreamStore.getState().clear(SESSION);
    expect(useStreamStore.getState().bySessionId[SESSION]).toBeUndefined();
    expect(useStreamStore.getState().bySessionId["other"]?.text).toBe("yo");
  });

  it("clear is a no-op for an unknown session (stable state)", () => {
    const before = useStreamStore.getState().bySessionId;
    useStreamStore.getState().clear("nope");
    expect(useStreamStore.getState().bySessionId).toBe(before);
  });
});
