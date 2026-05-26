/**
 * In-process event spine for inference stream deltas (Stage 9-1).
 *
 * The engine turn loop consumes `chatCompletionStream` and — in addition to
 * accumulating the canonical `InferenceResponse` — emits one
 * `StreamDeltaEvent` per provider chunk on this bus. The `vex-app`
 * main-process bridge (Stage 9-2) will subscribe, re-validate through a
 * shared Zod schema, sanitize tool-arg deltas, and broadcast to renderers as
 * an EPHEMERAL preview.
 *
 * Contract (identical posture to `transcript-bus.ts`):
 *  - This bus is a PREVIEW signal. The DB transcript stays the source of
 *    truth; the persisted message DTO (delivered via the transcript-append
 *    event AFTER commit) is canonical. Stream deltas are never persisted.
 *  - The bus is a deliberately minimal `Set<listener>`. `src/vex-agent` is
 *    the canonical engine layer and must not import anything from `vex-app/`.
 *    The shape is intentionally cloned from `TranscriptEventBus` so reviewers
 *    spot the pattern across both halves.
 *  - A misbehaving listener is isolated by try/catch and must never bubble
 *    back into the inference path.
 *  - The emitted `delta` payload is schema-specific — NEVER the raw provider
 *    SDK chunk. Tool-arg deltas are passed through here for the engine bus;
 *    the 9-2 bridge owns renderer-facing sanitization.
 */

import type { InferenceUsage, StreamChunk } from "@vex-agent/inference/types.js";

/** Discriminator literal — kept in sync with the future shared Zod schema. */
export const STREAM_DELTA_EVENT_TYPE = "engine.stream.delta" as const;

export type StreamDeltaType =
  | "text"
  | "tool_call"
  | "reasoning"
  | "usage"
  | "done"
  | "error";

/**
 * Schema-specific, discriminated delta payloads. `kind` mirrors the
 * event-level `deltaType`; the payload carries its own discriminant so
 * consumers can narrow `delta` directly.
 */
export type StreamDeltaPayload =
  | { readonly kind: "text"; readonly text: string }
  | {
      readonly kind: "tool_call";
      readonly toolCallIndex: number;
      readonly toolCallId: string | null;
      readonly toolCallName: string | null;
      readonly argsDelta: string | null;
    }
  | { readonly kind: "reasoning"; readonly text: string }
  | { readonly kind: "usage"; readonly usage: InferenceUsage }
  | { readonly kind: "done" }
  | { readonly kind: "error"; readonly message: string; readonly code: number | null };

export interface StreamDeltaEvent {
  readonly type: typeof STREAM_DELTA_EVENT_TYPE;
  /** Owning session row id (UUID). */
  readonly sessionId: string;
  /** Per-turn stream id minted by `executeTurn`; correlates deltas of one turn. */
  readonly streamId: string;
  /** Monotonic per-stream counter, starting at 0. */
  readonly sequence: number;
  /** Top-level discriminator; always equals `delta.kind`. */
  readonly deltaType: StreamDeltaType;
  readonly delta: StreamDeltaPayload;
  /** ISO timestamp minted at emit time. */
  readonly createdAt: string;
  /** Optional caller correlation id (reserved; null in 9-1). */
  readonly correlationId: string | null;
}

export type StreamDeltaListener = (event: StreamDeltaEvent) => void;

export class StreamDeltaBus {
  private readonly listeners = new Set<StreamDeltaListener>();

  emit(event: StreamDeltaEvent): void {
    // A misbehaving listener must not poison the rest of the bus — every
    // subscriber is isolated by try/catch (matches `TranscriptEventBus`).
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // intentionally swallowed — subscriber error must not bubble back
        // into the inference path
      }
    }
  }

  subscribe(listener: StreamDeltaListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  size(): number {
    return this.listeners.size;
  }

  clear(): void {
    this.listeners.clear();
  }
}

/**
 * Singleton bus shared by every in-process producer. Tests inject a
 * standalone instance (or subscribe to this one and unsubscribe) to keep
 * state isolation cheap; production code never instantiates a second bus.
 */
export const streamDeltaBus = new StreamDeltaBus();

/** Maps the discriminated payload's `kind` from a provider chunk's `type`. */
function toDeltaPayload(chunk: StreamChunk): StreamDeltaPayload {
  switch (chunk.type) {
    case "content":
      return { kind: "text", text: chunk.text ?? "" };
    case "tool_call_delta":
      return {
        kind: "tool_call",
        toolCallIndex: chunk.toolCallIndex ?? 0,
        toolCallId: chunk.toolCallId ?? null,
        toolCallName: chunk.toolCallName ?? null,
        argsDelta: chunk.toolCallArgsDelta ?? null,
      };
    case "reasoning":
      return { kind: "reasoning", text: chunk.reasoningText ?? "" };
    case "usage":
      return {
        kind: "usage",
        usage: chunk.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      };
    case "done":
      return { kind: "done" };
    case "error":
      return {
        kind: "error",
        message: chunk.errorMessage ?? "stream error",
        code: chunk.errorCode ?? null,
      };
  }
}

/**
 * Build a `StreamDeltaEvent` from a raw provider `StreamChunk`. This is the
 * seam where provider-shaped chunks become the engine's schema-specific
 * delta. `createdAt` is minted here; `sequence` is supplied by the consumer.
 */
export function toStreamDeltaEvent(
  sessionId: string,
  streamId: string,
  sequence: number,
  chunk: StreamChunk,
  correlationId: string | null = null,
): StreamDeltaEvent {
  const delta = toDeltaPayload(chunk);
  return {
    type: STREAM_DELTA_EVENT_TYPE,
    sessionId,
    streamId,
    sequence,
    deltaType: delta.kind,
    delta,
    createdAt: new Date().toISOString(),
    correlationId,
  };
}
