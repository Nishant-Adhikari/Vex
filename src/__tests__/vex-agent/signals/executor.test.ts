/**
 * Signals-ingest executor loop — runs ingest on start, survives a tick failure,
 * and stops cleanly. DI'd ingest, no timers-mocking needed (initial delay is 0).
 */

import { describe, it, expect } from "vitest";
import { startSignalsIngestExecutor } from "@vex-agent/signals/executor.js";

describe("startSignalsIngestExecutor", () => {
  it("runs an ingest on start and stops cleanly", async () => {
    let calls = 0;
    let resolveFirst!: () => void;
    const first = new Promise<void>((r) => (resolveFirst = r));
    const handle = startSignalsIngestExecutor({
      intervalMs: 1_000_000, // don't fire a second tick during the test
      deps: { ingest: async () => { calls += 1; resolveFirst(); } },
    });
    await first;
    expect(calls).toBe(1);
    await handle.stop();
  });

  it("does not crash the loop when a tick throws", async () => {
    let resolveFirst!: () => void;
    const first = new Promise<void>((r) => (resolveFirst = r));
    const handle = startSignalsIngestExecutor({
      intervalMs: 1_000_000,
      deps: { ingest: async () => { resolveFirst(); throw new Error("feed down"); } },
    });
    await first;
    // stop() awaits the in-flight (rejected) tick without throwing
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
