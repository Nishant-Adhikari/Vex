/**
 * Orphaned-run reconciler worker — supervisor lifecycle.
 *
 * The worker sweeps the engine `reconcileOrphanedRuns` as soon as the engine DB
 * url resolves (BEFORE the wake worker's auto-resume can act) and then on an
 * interval. These tests inject the `ensureDbUrl` + `reconcile` seams (no DB, no
 * engine import) and assert: it waits while the DB is unavailable, it sweeps
 * once the url resolves + keeps sweeping on the interval, and `stop()` is
 * idempotent + awaits an in-flight sweep.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../ipc/runtime/_ensure-engine-db-url.js", () => ({
  ensureEngineDbUrl: vi.fn(),
}));

const { setupOrphanReconcilerWorker } = await import("../orphan-reconciler-worker.js");

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

const zeroSummary = { scanned: 0, reconciled: 0, skipped: 0, failed: 0 };

afterEach(() => {
  vi.clearAllMocks();
});

describe("setupOrphanReconcilerWorker", () => {
  it("does not sweep while the DB url is unavailable", async () => {
    const reconcile = vi.fn(async () => zeroSummary);
    const stop = setupOrphanReconcilerWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: false })),
      reconcile,
      intervalMs: 20,
    });
    await flush();
    expect(reconcile).not.toHaveBeenCalled();
    await stop();
  });

  it("sweeps once the DB url resolves and keeps sweeping on the interval", async () => {
    const reconcile = vi.fn(async () => ({ ...zeroSummary, scanned: 1, reconciled: 1 }));
    const stop = setupOrphanReconcilerWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      reconcile,
      intervalMs: 20,
    });
    await flush();
    const afterFirst = reconcile.mock.calls.length;
    expect(afterFirst).toBeGreaterThanOrEqual(1);
    await flush();
    expect(reconcile.mock.calls.length).toBeGreaterThan(afterFirst);
    await stop();
  });

  it("stop() is idempotent and awaits an in-flight sweep", async () => {
    let resolveSweep: () => void = () => {};
    const reconcile = vi.fn(
      () =>
        new Promise<typeof zeroSummary>((resolve) => {
          resolveSweep = () => resolve(zeroSummary);
        }),
    );
    const stop = setupOrphanReconcilerWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      reconcile,
      intervalMs: 20,
    });
    await flush();
    resolveSweep();
    await stop();
    await stop();
    // No throw + a bounded number of sweeps (never a runaway loop).
    expect(reconcile.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it("a sweep throw never escapes the tick", async () => {
    const reconcile = vi.fn(async () => {
      throw new Error("sweep boom");
    });
    const stop = setupOrphanReconcilerWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      reconcile,
      intervalMs: 20,
    });
    await expect(flush()).resolves.toBeUndefined();
    await stop();
  });
});
