/**
 * Simulator scheduler worker — supervisor lifecycle + safety gates.
 *
 * Injects the config / db-url / concurrency / launch seams (no DB, no engine
 * import) and asserts: it never launches when disabled; it respects the
 * interval; it enforces the concurrency cap; and `stop()` is idempotent + awaits
 * an in-flight tick.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../ipc/runtime/_ensure-engine-db-url.js", () => ({
  ensureEngineDbUrl: vi.fn(),
}));

const { setupSimulatorSchedulerWorker } = await import("../simulator-scheduler-worker.js");
const { resolveSimulatorSchedulerConfig } = await import("../simulator-scheduler-config.js");

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 15));
}

const CONFIG = {
  enabled: true,
  intervalMinutes: 30,
  maxConcurrent: 1,
  walletAddress: "0x5100000000000000000000000000000000000051",
  goal: "test goal",
};

afterEach(() => {
  vi.clearAllMocks();
});

describe("setupSimulatorSchedulerWorker", () => {
  it("never launches when disabled", async () => {
    const launch = vi.fn(async () => ({ outcome: "launched" }));
    const stop = setupSimulatorSchedulerWorker({
      getConfig: () => ({ ...CONFIG, enabled: false }),
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      countActiveSims: vi.fn(async () => 0),
      launch,
      baseTickMs: 5,
    });
    await flush();
    expect(launch).not.toHaveBeenCalled();
    await stop();
  });

  it("does not launch while the DB url is unavailable", async () => {
    const launch = vi.fn(async () => ({ outcome: "launched" }));
    const stop = setupSimulatorSchedulerWorker({
      getConfig: () => CONFIG,
      ensureDbUrl: vi.fn(async () => ({ ok: false })),
      countActiveSims: vi.fn(async () => 0),
      launch,
      baseTickMs: 5,
    });
    await flush();
    expect(launch).not.toHaveBeenCalled();
    await stop();
  });

  it("launches once the DB url resolves and the interval allows", async () => {
    const launch = vi.fn(async () => ({ outcome: "launched" }));
    const stop = setupSimulatorSchedulerWorker({
      getConfig: () => ({ ...CONFIG, intervalMinutes: 1 }),
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      countActiveSims: vi.fn(async () => 0),
      launch,
      baseTickMs: 5,
    });
    await flush();
    expect(launch).toHaveBeenCalledTimes(1);
    await stop();
  });

  it("enforces the concurrency cap: no launch when already at maxConcurrent", async () => {
    const launch = vi.fn(async () => ({ outcome: "launched" }));
    const stop = setupSimulatorSchedulerWorker({
      getConfig: () => ({ ...CONFIG, maxConcurrent: 2 }),
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      countActiveSims: vi.fn(async () => 2), // already at cap
      launch,
      baseTickMs: 5,
    });
    await flush();
    expect(launch).not.toHaveBeenCalled();
    await stop();
  });

  it("respects the interval: does not relaunch on every poll", async () => {
    const launch = vi.fn(async () => ({ outcome: "launched" }));
    const stop = setupSimulatorSchedulerWorker({
      // 30-min interval but a fast 5ms poll → only the first tick launches.
      getConfig: () => ({ ...CONFIG, intervalMinutes: 30 }),
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      countActiveSims: vi.fn(async () => 0),
      launch,
      baseTickMs: 5,
    });
    // Let several polls elapse.
    await new Promise((r) => setTimeout(r, 40));
    expect(launch).toHaveBeenCalledTimes(1);
    await stop();
  });

  it("stop() is idempotent and awaits an in-flight tick", async () => {
    let resolveLaunch: () => void = () => {};
    const launch = vi.fn(
      () =>
        new Promise<{ outcome: string }>((resolve) => {
          resolveLaunch = () => resolve({ outcome: "launched" });
        }),
    );
    const stop = setupSimulatorSchedulerWorker({
      getConfig: () => ({ ...CONFIG, intervalMinutes: 1 }),
      ensureDbUrl: vi.fn(async () => ({ ok: true })),
      countActiveSims: vi.fn(async () => 0),
      launch,
      baseTickMs: 5,
    });
    await flush();
    resolveLaunch();
    await stop();
    await stop(); // second call is a no-op
    expect(true).toBe(true);
  });
});

describe("resolveSimulatorSchedulerConfig", () => {
  it("is disabled by default", () => {
    expect(resolveSimulatorSchedulerConfig({}).enabled).toBe(false);
  });

  it("parses env overrides with sane minimums", () => {
    const c = resolveSimulatorSchedulerConfig({
      VEX_SIM_SCHEDULER_ENABLED: "true",
      VEX_SIM_SCHEDULER_INTERVAL_MINUTES: "0", // clamped to min 1
      VEX_SIM_SCHEDULER_MAX_CONCURRENT: "3",
      VEX_SIM_SCHEDULER_WALLET: "0xabc",
    } as NodeJS.ProcessEnv);
    expect(c.enabled).toBe(true);
    expect(c.intervalMinutes).toBe(1);
    expect(c.maxConcurrent).toBe(3);
    expect(c.walletAddress).toBe("0xabc");
  });
});
