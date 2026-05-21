import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock surfaces BEFORE importing the bridge so the module wires its
// subscription against our stubs.
const broadcastMock = vi.fn();
vi.mock("../../lifecycle/broadcast.js", () => ({
  broadcastToAllWindows: (...args: unknown[]) => broadcastMock(...args),
}));

const logWarn = vi.fn();
vi.mock("../../logger/index.js", () => ({
  log: {
    info: vi.fn(),
    warn: (...args: unknown[]) => logWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// The engine bus is a real module — using the singleton lets us verify
// the "import directly from transcript-bus.js" constraint at runtime.
const { transcriptEventBus, TRANSCRIPT_APPEND_EVENT_TYPE } = await import(
  "@vex-agent/engine/events/transcript-bus.js"
);
const { setupTranscriptBridge } = await import("../transcript-bridge.js");
const { EV } = await import("@shared/ipc/channels.js");

const SESSION = "00000000-0000-4000-8000-000000000001";

function validPayload() {
  return {
    type: TRANSCRIPT_APPEND_EVENT_TYPE,
    sessionId: SESSION,
    messageId: 7,
    role: "assistant" as const,
    createdAt: "2026-05-21T10:00:00.000Z",
    messageType: null,
    correlationId: null,
  };
}

describe("transcript bridge", () => {
  beforeEach(() => {
    broadcastMock.mockReset();
    logWarn.mockReset();
    transcriptEventBus.clear();
  });

  it("broadcasts a schema-validated payload on EV.engine.transcriptAppend", () => {
    const teardown = setupTranscriptBridge();
    try {
      transcriptEventBus.emit(validPayload());
      expect(broadcastMock).toHaveBeenCalledTimes(1);
      expect(broadcastMock).toHaveBeenCalledWith(
        EV.engine.transcriptAppend,
        validPayload(),
      );
      expect(logWarn).not.toHaveBeenCalled();
    } finally {
      teardown();
    }
  });

  it("drops + logs payloads that fail .strict() validation", () => {
    const teardown = setupTranscriptBridge();
    try {
      // Cast around the engine TS type — the bridge is the last line of
      // defense, this proves it.
      transcriptEventBus.emit({
        ...validPayload(),
        sessionId: "not-a-uuid",
      } as never);
      expect(broadcastMock).not.toHaveBeenCalled();
      expect(logWarn).toHaveBeenCalledTimes(1);
      expect(logWarn.mock.calls[0]?.[0]).toContain(
        "dropped invalid engine.transcriptAppend payload",
      );
    } finally {
      teardown();
    }
  });

  it("teardown unsubscribes the bridge from the bus", () => {
    const teardown = setupTranscriptBridge();
    expect(transcriptEventBus.size()).toBe(1);
    teardown();
    expect(transcriptEventBus.size()).toBe(0);

    transcriptEventBus.emit(validPayload());
    expect(broadcastMock).not.toHaveBeenCalled();
  });

  it("does not crash when an extra field is smuggled in (strict drop)", () => {
    const teardown = setupTranscriptBridge();
    try {
      transcriptEventBus.emit({
        ...validPayload(),
        extra: "smuggle",
      } as never);
      expect(broadcastMock).not.toHaveBeenCalled();
    } finally {
      teardown();
    }
  });
});
