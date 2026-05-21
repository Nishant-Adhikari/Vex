/**
 * `EngineEventsBridge` — main -> renderer push events from the agent
 * runtime spine (engine).
 *
 * Naming follows the `EV.engine.<topic>` channel namespace and the
 * `window.vex.<domain>.on<Topic>` convention used for docker / database
 * progress streams. Each subscription returns an idempotent unsubscribe
 * function; the renderer must call it on cleanup (puzzle 02 mounts the
 * hook in `SessionPanel`, which unsubscribes on unmount).
 *
 * Renderer NEVER reconstructs message rows from the event payload. The
 * event is purely a refresh signal — the DB row is fetched through the
 * existing `messages.getTail` IPC after invalidation.
 */

import type { TranscriptAppendEvent } from "@shared/schemas/messages.js";

export interface EngineEventsBridge {
  /**
   * Subscribe to `EV.engine.transcriptAppend` events. The handler is
   * invoked once per committed `messages` INSERT for any session — the
   * renderer hook filters by `event.sessionId`.
   *
   * Returns an idempotent unsubscribe function.
   */
  readonly onTranscriptAppend: (
    cb: (event: TranscriptAppendEvent) => void,
  ) => () => void;
}
