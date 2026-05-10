/**
 * Migration progress pub/sub.
 *
 * In-process semantics:
 *  - `subscribe(cb)` registers a listener and immediately replays the
 *    most recent event (if any). The IPC handler is the only main-side
 *    subscriber today, registered at handler-registration time, so this
 *    replay primarily protects against re-registration races.
 *  - `peek()` returns the most recent event without subscribing — the
 *    IPC handler uses it to send the latest state directly to a joined
 *    single-flight caller's webContents (codex turn 2 should-fix #4).
 *    Renderer subscribers listen to Electron events, not this bus, so
 *    this hop is what actually delivers replay across the IPC boundary.
 *  - `reset()` is called at the start of every fresh migrate run so a
 *    later run never sees `applied 14/15` from a prior failed attempt.
 */

import type { MigrateProgress } from "@shared/schemas/database.js";

class ReplayBus<T> {
  private readonly listeners = new Set<(payload: T) => void>();
  private lastEvent: T | null = null;

  emit(payload: T): void {
    this.lastEvent = payload;
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch {
        // a misbehaving listener must not poison the rest of the bus
      }
    }
  }

  subscribe(listener: (payload: T) => void): () => void {
    this.listeners.add(listener);
    if (this.lastEvent !== null) {
      try {
        listener(this.lastEvent);
      } catch {
        /* ignore */
      }
    }
    return () => {
      this.listeners.delete(listener);
    };
  }

  peek(): T | null {
    return this.lastEvent;
  }

  reset(): void {
    this.lastEvent = null;
  }

  size(): number {
    return this.listeners.size;
  }
}

export const migrationProgressBus = new ReplayBus<MigrateProgress>();
