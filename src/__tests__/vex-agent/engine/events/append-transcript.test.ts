import { describe, expect, it, vi, beforeEach } from "vitest";

const mockAddMessageReturningId = vi.fn();
const mockWithTransaction = vi.fn();

vi.mock("@vex-agent/db/client.js", () => ({
  withTransaction: (fn: (client: unknown) => Promise<unknown>) =>
    mockWithTransaction(fn),
}));

vi.mock("@vex-agent/db/repos/messages.js", () => ({
  addMessageReturningId: (...args: unknown[]) =>
    mockAddMessageReturningId(...args),
}));

const {
  appendMessage,
  appendEngineMessage,
  emitTranscriptAppend,
} = await import(
  "../../../../vex-agent/engine/events/append-transcript.js"
);
const { TranscriptEventBus, TRANSCRIPT_APPEND_EVENT_TYPE } = await import(
  "../../../../vex-agent/engine/events/transcript-bus.js"
);

const SESSION = "00000000-0000-4000-8000-000000000001";

const INSERTED_MESSAGE = {
  role: "assistant" as const,
  content: "hello",
  timestamp: "2026-05-21T10:00:00.000Z",
  id: 99,
  metadata: { messageType: "chat" },
};

beforeEach(() => {
  mockAddMessageReturningId.mockReset();
  mockWithTransaction.mockReset();
});

describe("appendMessage — no external client (own tx)", () => {
  it("opens its own transaction, persists, and emits AFTER the wrapper resolves", async () => {
    const bus = new TranscriptEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    const callOrder: string[] = [];
    mockWithTransaction.mockImplementationOnce(async (fn) => {
      callOrder.push("withTransaction.start");
      const fakeClient = { __client__: true };
      mockAddMessageReturningId.mockImplementationOnce(async () => {
        callOrder.push("addMessageReturningId");
        return INSERTED_MESSAGE;
      });
      const result = await fn(fakeClient);
      callOrder.push("withTransaction.end");
      return result;
    });

    const result = await appendMessage(
      SESSION,
      { role: "assistant", content: "hello", timestamp: "in-memory" },
      { messageType: "chat", source: "assistant" },
      { bus, correlationId: "corr-1" },
    );

    callOrder.push("emit-check");

    expect(result).toEqual(INSERTED_MESSAGE);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({
      type: TRANSCRIPT_APPEND_EVENT_TYPE,
      sessionId: SESSION,
      messageId: 99,
      role: "assistant",
      createdAt: "2026-05-21T10:00:00.000Z",
      messageType: "chat",
      correlationId: "corr-1",
    });
    // emit happens only after withTransaction resolves (i.e. after COMMIT)
    expect(callOrder).toEqual([
      "withTransaction.start",
      "addMessageReturningId",
      "withTransaction.end",
      "emit-check",
    ]);
  });

  it("does NOT emit when the inner DB write throws", async () => {
    const bus = new TranscriptEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    mockWithTransaction.mockImplementationOnce(async (fn) => {
      mockAddMessageReturningId.mockRejectedValueOnce(new Error("INSERT failed"));
      await fn({ __client__: true });
      // withTransaction would itself rollback + rethrow; we re-throw to match
      throw new Error("INSERT failed");
    });

    await expect(
      appendMessage(
        SESSION,
        { role: "assistant", content: "hello", timestamp: "in-memory" },
        { messageType: "chat" },
        { bus },
      ),
    ).rejects.toThrow("INSERT failed");

    expect(listener).not.toHaveBeenCalled();
  });

  it("falls back to messageType=null when metadata omits it", async () => {
    const bus = new TranscriptEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    mockWithTransaction.mockImplementationOnce(async (fn) => {
      mockAddMessageReturningId.mockResolvedValueOnce({
        ...INSERTED_MESSAGE,
        metadata: null,
      });
      return fn({ __client__: true });
    });

    await appendMessage(
      SESSION,
      { role: "user", content: "hi", timestamp: "x" },
      undefined,
      { bus },
    );

    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: null, correlationId: null }),
    );
  });
});

describe("appendMessage — external client path", () => {
  it("delegates to addMessageReturningId with the caller's client and does NOT emit", async () => {
    const bus = new TranscriptEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    const callerClient = { __caller_client__: true };
    mockAddMessageReturningId.mockResolvedValueOnce(INSERTED_MESSAGE);

    const result = await appendMessage(
      SESSION,
      { role: "assistant", content: "hello", timestamp: "x" },
      { messageType: "chat" },
      { client: callerClient as never, bus },
    );

    expect(mockWithTransaction).not.toHaveBeenCalled();
    expect(mockAddMessageReturningId).toHaveBeenCalledTimes(1);
    expect(mockAddMessageReturningId).toHaveBeenCalledWith(
      SESSION,
      expect.any(Object),
      expect.any(Object),
      callerClient,
    );
    expect(result).toEqual(INSERTED_MESSAGE);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("appendEngineMessage", () => {
  it("routes through appendMessage with role default 'system'", async () => {
    const bus = new TranscriptEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    mockWithTransaction.mockImplementationOnce(async (fn) => {
      mockAddMessageReturningId.mockResolvedValueOnce({
        ...INSERTED_MESSAGE,
        role: "system",
      });
      return fn({});
    });

    await appendEngineMessage(
      SESSION,
      "[engine: continue]",
      { source: "engine", messageType: "continue", visibility: "internal" },
      { bus },
    );

    const passedMsg = mockAddMessageReturningId.mock.calls[0]?.[1];
    expect(passedMsg).toMatchObject({ role: "system", content: "[engine: continue]" });
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({ role: "system", messageType: "continue" }),
    );
  });
});

describe("emitTranscriptAppend helper", () => {
  it("emits straight onto the bus for tx-aware callers", () => {
    const bus = new TranscriptEventBus();
    const listener = vi.fn();
    bus.subscribe(listener);

    const event = {
      type: TRANSCRIPT_APPEND_EVENT_TYPE,
      sessionId: SESSION,
      messageId: 1,
      role: "user" as const,
      createdAt: "2026-05-21T10:00:00.000Z",
      messageType: null,
      correlationId: null,
    };

    emitTranscriptAppend(event, bus);

    expect(listener).toHaveBeenCalledWith(event);
  });
});
