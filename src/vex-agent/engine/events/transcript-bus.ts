/**
 * In-process event spine for transcript appends.
 *
 * Producers (chat turn, runner, tool overflow, operator instructions,
 * wake executor, …) emit a `TranscriptAppendEvent` AFTER the DB row has
 * been committed. The `vex-app` main-process bridge subscribes, runs the
 * payload through the shared Zod schema, then broadcasts via
 * `broadcastToAllWindows` so renderers can invalidate their TanStack
 * Query cache for the affected session.
 *
 * The bus is a deliberately minimal `Set<listener>`. We do NOT extend
 * Node's `EventEmitter` because:
 *  - the public surface stays smaller (no `removeAllListeners`,
 *    `setMaxListeners`, etc. that we never use);
 *  - subscribe returns its own idempotent unsubscribe (matches the
 *    `vex-app/src/main/events/event-bus.ts` `Bus<T>` convention);
 *  - `src/vex-agent` is the canonical engine layer and must not import
 *    anything from `vex-app/`. The bus shape is intentionally cloned
 *    from `Bus<T>` so reviewers spot the pattern across both halves.
 *
 * **Contract**: the bus is the signal layer. The DB is the source of
 * truth. Subscribers that need the actual message DTO must fetch through
 * the existing `vex-app/src/main/database/messages-db.ts` mapper — they
 * never reconstruct the row from this event payload.
 */

/** Discriminator literal — kept in sync with `transcriptAppendEventSchema`. */
export const TRANSCRIPT_APPEND_EVENT_TYPE = "engine.transcript.append" as const;

/** Roles mirror `db/repos/messages.ts` `Message["role"]`. */
export type TranscriptAppendRole =
  | "system"
  | "user"
  | "assistant"
  | "tool";

export interface TranscriptAppendEvent {
  readonly type: typeof TRANSCRIPT_APPEND_EVENT_TYPE;
  /** Owning session row id (UUID). */
  readonly sessionId: string;
  /** Inserted `messages.id` (SERIAL PK) — stable across restarts. */
  readonly messageId: number;
  /** Mirrors `messages.role`. */
  readonly role: TranscriptAppendRole;
  /** Canonical ISO timestamp returned by the INSERT RETURNING clause. */
  readonly createdAt: string;
  /**
   * Engine marker discriminator — mirrors `messages.message_type`. The
   * mapper in `messages-db.ts` consumes this column to derive
   * `MessageKind` ("runtime_notice" today; widened per-marker in puzzles
   * 04/05/07). `null` means a plain chat row.
   */
  readonly messageType: string | null;
  /** Optional caller-supplied correlation id (chat turn, mission run, …). */
  readonly correlationId: string | null;
}

export type TranscriptAppendListener = (event: TranscriptAppendEvent) => void;

export class TranscriptEventBus {
  private readonly listeners = new Set<TranscriptAppendListener>();

  emit(event: TranscriptAppendEvent): void {
    // A misbehaving listener must not poison the rest of the bus —
    // every subscriber is isolated by a try/catch (matches the
    // `vex-app/src/main/events/event-bus.ts` Bus<T> convention).
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // intentionally swallowed — subscriber error must not bubble
        // back into the engine write path
      }
    }
  }

  subscribe(listener: TranscriptAppendListener): () => void {
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
 * standalone instance via `appendMessage({ bus })` to keep state
 * isolation cheap; production code never instantiates a second bus.
 */
export const transcriptEventBus = new TranscriptEventBus();
