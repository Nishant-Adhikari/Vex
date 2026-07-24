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

  it("runs the afterIngest hook after each ingest tick", async () => {
    const order: string[] = [];
    let resolveHook!: () => void;
    const hookDone = new Promise<void>((r) => (resolveHook = r));
    const handle = startSignalsIngestExecutor({
      intervalMs: 1_000_000,
      deps: { ingest: async () => { order.push("ingest"); } },
      afterIngest: async () => { order.push("afterIngest"); resolveHook(); },
    });
    await hookDone;
    expect(order).toEqual(["ingest", "afterIngest"]);
    await handle.stop();
  });

  it("runs afterIngest even when the ingest tick fails", async () => {
    let resolveHook!: () => void;
    const hookDone = new Promise<void>((r) => (resolveHook = r));
    let hookRan = false;
    const handle = startSignalsIngestExecutor({
      intervalMs: 1_000_000,
      deps: { ingest: async () => { throw new Error("feed down"); } },
      afterIngest: async () => { hookRan = true; resolveHook(); },
    });
    await hookDone;
    expect(hookRan).toBe(true);
    await handle.stop();
  });

  it("aborts the afterIngest signal on stop so a slow hook can't block quit", async () => {
    let seenSignal: AbortSignal | null = null;
    let releaseHook!: () => void;
    const hookHolding = new Promise<void>((r) => (releaseHook = r));
    let hookEntered!: () => void;
    const entered = new Promise<void>((r) => (hookEntered = r));
    const handle = startSignalsIngestExecutor({
      intervalMs: 1_000_000,
      deps: { ingest: async () => {} },
      afterIngest: async (signal) => {
        seenSignal = signal;
        hookEntered();
        await hookHolding; // simulate a slow pass in flight when stop() is called
      },
    });
    await entered;
    expect(seenSignal).not.toBeNull();
    expect((seenSignal as unknown as AbortSignal).aborted).toBe(false);
    // stop() must abort the signal (so the hook can wind down) before awaiting.
    const stopping = handle.stop();
    expect((seenSignal as unknown as AbortSignal).aborted).toBe(true);
    releaseHook();
    await expect(stopping).resolves.toBeUndefined();
  });

  it("does not crash the loop when the afterIngest hook throws", async () => {
    let resolveHook!: () => void;
    const hookDone = new Promise<void>((r) => (resolveHook = r));
    const handle = startSignalsIngestExecutor({
      intervalMs: 1_000_000,
      deps: { ingest: async () => {} },
      afterIngest: async () => { resolveHook(); throw new Error("grade boom"); },
    });
    await hookDone;
    // stop() settles the in-flight tick (whose hook rejected) without throwing
    await expect(handle.stop()).resolves.toBeUndefined();
  });
});
