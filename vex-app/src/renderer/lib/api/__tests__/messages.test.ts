/**
 * Tests for the live transcript sync hook (agent integration puzzle 02).
 *
 * Verifies:
 *  - subscribe + setInterval wiring on mount;
 *  - invalidation prefix matches `messagesKeys.forSession(sessionId)`
 *    and reaches BOTH `useMessageTail(s, 50)` and `useMessageTail(s, 100)`
 *    so the puzzle-02 re-key works as designed;
 *  - mismatched sessionId payloads are ignored;
 *  - unmount unsubscribes + clears the interval.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createElement } from "react";

import {
  useTranscriptLiveSync,
  TRANSCRIPT_LIVE_FALLBACK_POLL_MS,
} from "../messages.js";
import { messagesKeys } from "../queryKeys.js";

type TranscriptListener = (event: {
  type: string;
  sessionId: string;
  messageId: number;
  role: string;
  createdAt: string;
  messageType: string | null;
  correlationId: string | null;
}) => void;

let lastSubscribedListener: TranscriptListener | null = null;
const unsubscribeMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  lastSubscribedListener = null;
  unsubscribeMock.mockReset();
  // Stub the renderer-visible bridge surface — production wires this in
  // preload/agent/engine.ts.
  Object.defineProperty(window, "vex", {
    configurable: true,
    writable: true,
    value: {
      engine: {
        onTranscriptAppend: (cb: TranscriptListener) => {
          lastSubscribedListener = cb;
          return unsubscribeMock;
        },
      },
    },
  });
});

afterEach(() => {
  vi.useRealTimers();
  // Cleanup window.vex stub.
  // @ts-expect-error — test cleanup
  delete window.vex;
});

const SESSION_A = "00000000-0000-4000-8000-00000000000a";
const SESSION_B = "00000000-0000-4000-8000-00000000000b";

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { readonly children: ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function sampleEvent(sessionId: string, messageId = 1) {
  return {
    type: "engine.transcript.append",
    sessionId,
    messageId,
    role: "assistant",
    createdAt: "2026-05-21T10:00:00.000Z",
    messageType: null,
    correlationId: null,
  };
}

describe("useTranscriptLiveSync", () => {
  it("subscribes to the engine bridge on mount and unsubscribes on unmount", () => {
    const client = new QueryClient();
    const { unmount } = renderHook(() => useTranscriptLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    expect(lastSubscribedListener).not.toBeNull();
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it("no-ops on null / empty sessionId (no subscribe, no interval)", () => {
    const client = new QueryClient();
    renderHook(() => useTranscriptLiveSync(null), {
      wrapper: makeWrapper(client),
    });
    expect(lastSubscribedListener).toBeNull();
  });

  it("invalidates the session prefix on a matching transcriptAppend event", async () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderHook(() => useTranscriptLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    lastSubscribedListener!(sampleEvent(SESSION_A));

    expect(invalidateSpy).toHaveBeenCalledTimes(1);
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: messagesKeys.forSession(SESSION_A),
    });
  });

  it("ignores events for a different session", () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    renderHook(() => useTranscriptLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    lastSubscribedListener!(sampleEvent(SESSION_B));

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("runs the 30s fallback poll while the hook is mounted", () => {
    const client = new QueryClient();
    const invalidateSpy = vi.spyOn(client, "invalidateQueries");

    const { unmount } = renderHook(() => useTranscriptLiveSync(SESSION_A), {
      wrapper: makeWrapper(client),
    });

    // No interval call yet.
    expect(invalidateSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(TRANSCRIPT_LIVE_FALLBACK_POLL_MS);
    expect(invalidateSpy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(TRANSCRIPT_LIVE_FALLBACK_POLL_MS);
    expect(invalidateSpy).toHaveBeenCalledTimes(2);

    unmount();
    vi.advanceTimersByTime(TRANSCRIPT_LIVE_FALLBACK_POLL_MS);
    // No more invalidations after unmount.
    expect(invalidateSpy).toHaveBeenCalledTimes(2);
  });

  it("prefix invalidation reaches every active variant for the same session", () => {
    // This test pins the puzzle-02 re-key: `messagesKeys.forSession(s)`
    // must match `tail(s, 50)`, `tail(s, 100)`, `list(s, 50, null)`, and
    // `around(s, ..., before, after)` — all under the
    // `["messages", sessionId]` prefix.
    const tail50 = messagesKeys.tail(SESSION_A, 50);
    const tail100 = messagesKeys.tail(SESSION_A, 100);
    const list = messagesKeys.list(SESSION_A, 50, null);
    const around = messagesKeys.around(SESSION_A, 5, 3, 3);
    const prefix = messagesKeys.forSession(SESSION_A);

    expect(tail50.slice(0, prefix.length)).toEqual(prefix);
    expect(tail100.slice(0, prefix.length)).toEqual(prefix);
    expect(list.slice(0, prefix.length)).toEqual(prefix);
    expect(around.slice(0, prefix.length)).toEqual(prefix);
  });
});
