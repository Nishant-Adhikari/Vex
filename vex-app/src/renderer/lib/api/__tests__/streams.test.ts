/**
 * Tests for `useStreamPreviewSync` (stage 9-3):
 *  - subscribes to onStreamDelta + onTranscriptAppend on mount;
 *  - a matching delta feeds the streamStore; foreign-session deltas are ignored;
 *  - an assistant transcriptAppend clears the preview AFTER the refetch settles;
 *  - a non-assistant append does not clear;
 *  - an orphaned preview is cleared by the idle timeout;
 *  - unmount unsubscribes both listeners, clears the preview, and disarms timers.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type ReactNode } from "react";

import { STREAM_PREVIEW_IDLE_MS, useStreamPreviewSync } from "../streams.js";
import { useStreamStore } from "../../../stores/streamStore.js";
import type { StreamDeltaEvent } from "@shared/schemas/stream.js";

const SESSION_A = "00000000-0000-4000-8000-00000000000a";
const SESSION_B = "00000000-0000-4000-8000-00000000000b";

type DeltaCb = (e: StreamDeltaEvent) => void;
interface AppendEvent {
  type: string;
  sessionId: string;
  messageId: number;
  role: string;
  createdAt: string;
  messageType: string | null;
  correlationId: string | null;
}
type AppendCb = (e: AppendEvent) => void;

let deltaCb: DeltaCb | null;
let appendCb: AppendCb | null;
const offDelta = vi.fn();
const offAppend = vi.fn();

beforeEach(() => {
  deltaCb = null;
  appendCb = null;
  offDelta.mockReset();
  offAppend.mockReset();
  useStreamStore.setState({ bySessionId: {} });
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: {
      engine: {
        onStreamDelta: (cb: DeltaCb) => {
          deltaCb = cb;
          return offDelta;
        },
        onTranscriptAppend: (cb: AppendCb) => {
          appendCb = cb;
          return offAppend;
        },
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  // @ts-expect-error — test cleanup
  delete window.vex;
});

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function textDelta(sessionId: string, streamId = "s1", text = "hi"): StreamDeltaEvent {
  return {
    type: "engine.stream.delta",
    sessionId,
    streamId,
    sequence: 0,
    deltaType: "text",
    delta: { kind: "text", text },
    createdAt: "2026-05-26T10:00:00.000Z",
    correlationId: null,
  };
}

function append(sessionId: string, role = "assistant"): AppendEvent {
  return {
    type: "engine.transcript.append",
    sessionId,
    messageId: 1,
    role,
    createdAt: "2026-05-26T10:00:00.000Z",
    messageType: null,
    correlationId: null,
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("useStreamPreviewSync", () => {
  it("subscribes on mount, feeds deltas, and tears down on unmount", () => {
    const { unmount } = renderHook(() => useStreamPreviewSync(SESSION_A), {
      wrapper: makeWrapper(new QueryClient()),
    });
    expect(deltaCb).not.toBeNull();
    expect(appendCb).not.toBeNull();

    deltaCb!(textDelta(SESSION_A));
    expect(useStreamStore.getState().bySessionId[SESSION_A]?.text).toBe("hi");

    unmount();
    expect(offDelta).toHaveBeenCalledTimes(1);
    expect(offAppend).toHaveBeenCalledTimes(1);
    expect(useStreamStore.getState().bySessionId[SESSION_A]).toBeUndefined();
  });

  it("no-ops on a null sessionId", () => {
    renderHook(() => useStreamPreviewSync(null), { wrapper: makeWrapper(new QueryClient()) });
    expect(deltaCb).toBeNull();
  });

  it("ignores deltas for a different session", () => {
    renderHook(() => useStreamPreviewSync(SESSION_A), { wrapper: makeWrapper(new QueryClient()) });
    deltaCb!(textDelta(SESSION_B));
    expect(useStreamStore.getState().bySessionId[SESSION_B]).toBeUndefined();
  });

  it("clears the preview after a matching assistant append (post-refetch)", async () => {
    renderHook(() => useStreamPreviewSync(SESSION_A), { wrapper: makeWrapper(new QueryClient()) });
    deltaCb!(textDelta(SESSION_A));
    expect(useStreamStore.getState().bySessionId[SESSION_A]).toBeDefined();

    appendCb!(append(SESSION_A, "assistant"));
    await flush();
    expect(useStreamStore.getState().bySessionId[SESSION_A]).toBeUndefined();
  });

  it("does not clear on a non-assistant append", async () => {
    renderHook(() => useStreamPreviewSync(SESSION_A), { wrapper: makeWrapper(new QueryClient()) });
    deltaCb!(textDelta(SESSION_A));
    appendCb!(append(SESSION_A, "tool"));
    await flush();
    expect(useStreamStore.getState().bySessionId[SESSION_A]).toBeDefined();
  });

  it("does not clear a newer stream when an older append's refetch settles late", async () => {
    const client = new QueryClient();
    let resolveInvalidate: (() => void) | null = null;
    vi.spyOn(client, "invalidateQueries").mockReturnValue(
      new Promise<void>((resolve) => {
        resolveInvalidate = () => resolve();
      }) as ReturnType<typeof client.invalidateQueries>,
    );
    renderHook(() => useStreamPreviewSync(SESSION_A), { wrapper: makeWrapper(client) });

    // Stream s1 previews; its assistant append fires (refetch now pending).
    deltaCb!(textDelta(SESSION_A, "s1", "first"));
    appendCb!(append(SESSION_A, "assistant"));

    // Before the refetch settles, the next turn's stream s2 begins.
    deltaCb!(textDelta(SESSION_A, "s2", "second"));
    expect(useStreamStore.getState().bySessionId[SESSION_A]?.streamId).toBe("s2");

    // s1's refetch resolves late — it must NOT clear s2's live preview.
    resolveInvalidate!();
    await flush();
    const current = useStreamStore.getState().bySessionId[SESSION_A];
    expect(current?.streamId).toBe("s2");
    expect(current?.text).toBe("second");
  });

  it("clears an orphaned preview after the idle timeout", () => {
    vi.useFakeTimers();
    renderHook(() => useStreamPreviewSync(SESSION_A), { wrapper: makeWrapper(new QueryClient()) });
    deltaCb!(textDelta(SESSION_A));
    expect(useStreamStore.getState().bySessionId[SESSION_A]).toBeDefined();

    vi.advanceTimersByTime(STREAM_PREVIEW_IDLE_MS + 1);
    expect(useStreamStore.getState().bySessionId[SESSION_A]).toBeUndefined();
  });
});
