import { describe, expect, it, vi } from "vitest";

import {
  TRANSCRIPT_APPEND_EVENT_TYPE,
  TranscriptEventBus,
  transcriptEventBus,
  type TranscriptAppendEvent,
} from "../../../../vex-agent/engine/events/transcript-bus.js";

function sampleEvent(overrides: Partial<TranscriptAppendEvent> = {}): TranscriptAppendEvent {
  return {
    type: TRANSCRIPT_APPEND_EVENT_TYPE,
    sessionId: "00000000-0000-4000-8000-000000000001",
    messageId: 42,
    role: "assistant",
    createdAt: "2026-05-21T10:00:00.000Z",
    messageType: null,
    correlationId: null,
    ...overrides,
  };
}

describe("transcript event bus", () => {
  it("delivers emit() to every subscriber", () => {
    const bus = new TranscriptEventBus();
    const a = vi.fn();
    const b = vi.fn();
    bus.subscribe(a);
    bus.subscribe(b);

    const event = sampleEvent();
    bus.emit(event);

    expect(a).toHaveBeenCalledTimes(1);
    expect(a).toHaveBeenCalledWith(event);
    expect(b).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledWith(event);
  });

  it("subscribe returns an idempotent unsubscribe", () => {
    const bus = new TranscriptEventBus();
    const listener = vi.fn();
    const off = bus.subscribe(listener);

    off();
    off(); // idempotent — must not throw, must not re-add
    bus.emit(sampleEvent());

    expect(listener).not.toHaveBeenCalled();
    expect(bus.size()).toBe(0);
  });

  it("isolates a misbehaving listener from the rest of the bus", () => {
    const bus = new TranscriptEventBus();
    const angry = vi.fn(() => {
      throw new Error("poison");
    });
    const calm = vi.fn();

    bus.subscribe(angry);
    bus.subscribe(calm);

    expect(() => bus.emit(sampleEvent())).not.toThrow();
    expect(angry).toHaveBeenCalledTimes(1);
    expect(calm).toHaveBeenCalledTimes(1);
  });

  it("size() reflects active subscriptions; clear() empties the bus", () => {
    const bus = new TranscriptEventBus();
    expect(bus.size()).toBe(0);
    bus.subscribe(() => {});
    bus.subscribe(() => {});
    expect(bus.size()).toBe(2);
    bus.clear();
    expect(bus.size()).toBe(0);
  });

  it("singleton transcriptEventBus is a TranscriptEventBus instance", () => {
    expect(transcriptEventBus).toBeInstanceOf(TranscriptEventBus);
  });
});
