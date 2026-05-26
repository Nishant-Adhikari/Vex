/**
 * Ephemeral stream-preview store (Stage 9-3).
 *
 * Holds the in-flight token-by-token preview for the active turn, keyed by
 * session. This is NOT the canonical transcript — it is a transient visual
 * preview that is discarded the moment the persisted message DTO arrives
 * (see `useStreamPreviewSync`). Per `vex-renderer-frontend`:
 *  - it is UI-only Zustand state, never persisted (agent traces must not be
 *    written to disk);
 *  - it never mirrors the Query Cache source of truth — the persisted
 *    messages live in TanStack Query, this holds only the un-persisted tail.
 *
 * A single response is bounded by the engine's max output tokens, so `text`
 * does not grow without bound.
 */

import { create } from "zustand";
import type { StreamDeltaEvent } from "@shared/schemas/stream.js";

export type StreamPhase = "streaming" | "done" | "error";

export interface StreamPreview {
  /** Per-turn stream id; a new id resets the preview. */
  readonly streamId: string;
  /** Accumulated assistant text (markdown), bounded by max output tokens. */
  readonly text: string;
  readonly phase: StreamPhase;
  /** Last tool name seen on this stream (shown only while text is empty). */
  readonly toolName: string | null;
}

interface StreamStoreState {
  readonly bySessionId: Readonly<Record<string, StreamPreview | undefined>>;
  readonly applyDelta: (sessionId: string, event: StreamDeltaEvent) => void;
  readonly clear: (sessionId: string) => void;
}

/** Fresh preview for a newly-seen streamId. */
function startPreview(streamId: string): StreamPreview {
  return { streamId, text: "", phase: "streaming", toolName: null };
}

/** Pure reducer: previous preview + delta → next preview. Exported for tests. */
export function reducePreview(
  prev: StreamPreview | undefined,
  event: StreamDeltaEvent,
): StreamPreview {
  // A delta from a new stream supersedes any earlier preview for the session.
  const base =
    prev !== undefined && prev.streamId === event.streamId
      ? prev
      : startPreview(event.streamId);

  switch (event.delta.kind) {
    case "text":
      return { ...base, phase: "streaming", text: base.text + event.delta.text };
    case "tool_call":
      return { ...base, toolName: event.delta.toolCallName ?? base.toolName ?? "tool" };
    case "done":
      return { ...base, phase: "done" };
    case "error":
      return { ...base, phase: "error" };
    case "reasoning":
    case "usage":
      // Not surfaced in 9-3 UI; still ensures the preview exists so a
      // reasoning-first stream shows the thinking indicator.
      return base;
  }
}

export const useStreamStore = create<StreamStoreState>((set) => ({
  bySessionId: {},
  applyDelta: (sessionId, event) =>
    set((state) => ({
      bySessionId: {
        ...state.bySessionId,
        [sessionId]: reducePreview(state.bySessionId[sessionId], event),
      },
    })),
  clear: (sessionId) =>
    set((state) => {
      if (state.bySessionId[sessionId] === undefined) return state;
      const next = { ...state.bySessionId };
      delete next[sessionId];
      return { bySessionId: next };
    }),
}));

/** Read-only selector for the active session's preview (null when none). */
export function useStreamPreview(sessionId: string | null): StreamPreview | null {
  return useStreamStore((s) =>
    sessionId === null ? null : s.bySessionId[sessionId] ?? null,
  );
}
