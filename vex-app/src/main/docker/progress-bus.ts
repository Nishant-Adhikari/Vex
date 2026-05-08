/**
 * Tiny in-process pub/sub for docker install/compose progress events.
 * The IPC handler subscribes here and forwards every payload to all
 * live BrowserWindows via `webContents.send`. This decouples the
 * spawn runners (which only know `(line) => emit(...)`) from the
 * preload subscription wiring.
 */

import type { ComposeLog, InstallProgress } from "@shared/schemas/docker.js";

class Bus<T> {
  private readonly listeners = new Set<(payload: T) => void>();

  emit(payload: T): void {
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

export const dockerProgressBus = new Bus<InstallProgress>();
export const composeLogBus = new Bus<ComposeLog>();
