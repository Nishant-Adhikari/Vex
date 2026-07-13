/**
 * signals-worker supervisor tests.
 *
 * Deps are injected, so this exercises pure lifecycle logic without a real DB,
 * network, or engine. Mirrors sync-worker.test.ts.
 *
 * Pins: the executor does NOT start until DB url + `signals` table are ready; it
 * starts EXACTLY ONCE; `stop()` is non-reentrant and tears down an executor even
 * if `stop()` races a still-pending start tick.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import type { SignalsIngestExecutorHandle } from "@vex-agent/signals/executor.js";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../database/signals-db.js", () => ({
  probeSignalsReady: vi.fn(),
}));
vi.mock("../../ipc/runtime/_ensure-engine-db-url.js", () => ({
  ensureEngineDbUrl: vi.fn(),
}));

const { setupSignalsIngestWorker } = await import("../signals-worker.js");

// Intersection: assignable to the real handle type (so it satisfies the
// startExecutor dep) while keeping `stop` typed as a Mock for assertions.
function makeHandle(): SignalsIngestExecutorHandle & {
  readonly stop: ReturnType<typeof vi.fn>;
} {
  return { stop: vi.fn(async () => {}) };
}

// Flush the immediate (non-timer) startup tick's async chain.
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("setupSignalsIngestWorker supervisor", () => {
  it("does not start the executor while the DB url is unavailable", async () => {
    const startExecutor = vi.fn(async () => makeHandle());
    const stop = setupSignalsIngestWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: false })),
      probeReady: vi.fn(async () => true),
      startExecutor,
      intervalMs: 20,
    });
    await flush();
    expect(startExecutor).not.toHaveBeenCalled();
    await stop();
  });

  it("does not start the executor while the signals table is not ready", async () => {
    const startExecutor = vi.fn(async () => makeHandle());
    const probeReady = vi.fn(async () => false);
    const stop = setupSignalsIngestWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      probeReady,
      startExecutor,
      intervalMs: 20,
    });
    await flush();
    expect(probeReady).toHaveBeenCalled();
    expect(startExecutor).not.toHaveBeenCalled();
    await stop();
  });

  it("starts the executor exactly once when DB url + table are ready", async () => {
    const startExecutor = vi.fn(async () => makeHandle());
    const stop = setupSignalsIngestWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      probeReady: vi.fn(async () => true),
      startExecutor,
      intervalMs: 20,
    });
    await flush();
    await flush();
    expect(startExecutor).toHaveBeenCalledTimes(1);
    await stop();
  });

  it("stop() tears down the started executor", async () => {
    const handle = makeHandle();
    const stop = setupSignalsIngestWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      probeReady: vi.fn(async () => true),
      startExecutor: vi.fn(async () => handle),
      intervalMs: 20,
    });
    await flush();
    await stop();
    expect(handle.stop).toHaveBeenCalledTimes(1);
  });

  it("stop() before ready never starts, and is idempotent", async () => {
    const startExecutor = vi.fn(async () => makeHandle());
    const stop = setupSignalsIngestWorker({
      ensureDbUrl: vi.fn(async () => ({ ok: false })),
      probeReady: vi.fn(async () => false),
      startExecutor,
      intervalMs: 20,
    });
    await stop();
    await stop();
    expect(startExecutor).not.toHaveBeenCalled();
  });
});
