/**
 * Tiny in-process pub/sub for docker install/compose progress events.
 * The IPC handler subscribes here and forwards every payload to all
 * live BrowserWindows via `webContents.send`. This decouples the
 * spawn runners (which only know `(line) => emit(...)`) from the
 * preload subscription wiring.
 */

import type { InstallProgress } from "@shared/schemas/docker.js";

type Listener = (payload: InstallProgress) => void;

class ProgressBus {
  private readonly listeners = new Set<Listener>();

  emit(payload: InstallProgress): void {
    for (const listener of this.listeners) {
      try {
        listener(payload);
      } catch {
        // a misbehaving listener must not poison the rest of the bus
      }
    }
  }

  subscribe(listener: Listener): () => void {
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

export const dockerProgressBus = new ProgressBus();
