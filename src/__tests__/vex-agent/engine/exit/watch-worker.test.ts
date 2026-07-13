/**
 * Exit-watch worker — thin-wrapper plumbing coverage.
 *
 * Pins the sequencing contract (load → cycle → emit → persist) and loop
 * survival, all with injected fakes: no timers required for the unit-level
 * `runExitWatchTick` assertions, and a fake clock / manual pump for the loop.
 */

import { describe, it, expect, vi } from "vitest";
import {
  runExitWatchTick,
  setupExitWatchWorker,
  type ExitWatchWorkerDeps,
} from "@vex-agent/engine/exit/watch-worker.js";
import { type WatchInputPosition } from "@vex-agent/engine/exit/watch-cycle.js";
import { type ExitConfig } from "@vex-agent/engine/exit/exit-rules.js";

const CONFIG: ExitConfig = {
  takeProfitLadder: [
    { multiple: 2, sellFraction: 0.5 },
    { multiple: 3, sellFraction: 0.5 },
  ],
  stopLossPct: 0.35,
  trailingStopPct: 0.25,
  timeStopMinutes: 240,
  timeStopFlatBandPct: 0.15,
};

const OPENED_AT = 1_000_000;

function makeInput(overrides: Partial<WatchInputPosition> = {}): WatchInputPosition {
  return {
    token: "So11111111111111111111111111111111111111112",
    entryPriceUsd: 1,
    amountTokens: 1000,
    openedAtMs: OPENED_AT,
    consumedRungs: [],
    priorPeakPriceUsd: 1,
    ...overrides,
  };
}

describe("runExitWatchTick", () => {
  it("loads positions, emits an alert per position, and persists the refreshed peak", async () => {
    const emitAlert = vi.fn();
    const savePeak = vi.fn();
    const deps: ExitWatchWorkerDeps = {
      getOpenPositions: async () => [makeInput({ token: "WIN", priorPeakPriceUsd: 1.5 })],
      priceOf: () => 2, // hits TP rung 0 and lifts peak to 2
      emitAlert,
      savePeak,
      config: CONFIG,
      now: () => OPENED_AT + 60_000,
    };

    const alerts = await runExitWatchTick(deps);

    expect(alerts).toHaveLength(1);
    expect(alerts[0].token).toBe("WIN");
    expect(alerts[0].decisions[0].kind).toBe("take_profit");
    expect(emitAlert).toHaveBeenCalledTimes(1);
    expect(emitAlert).toHaveBeenCalledWith(alerts[0]);
    expect(savePeak).toHaveBeenCalledWith("WIN", 2);
  });

  it("still persists the carried peak when the price is unavailable", async () => {
    const savePeak = vi.fn();
    const deps: ExitWatchWorkerDeps = {
      getOpenPositions: async () => [makeInput({ token: "MISS", priorPeakPriceUsd: 2.5 })],
      priceOf: () => null,
      emitAlert: vi.fn(),
      savePeak,
      config: CONFIG,
    };

    const [alert] = await runExitWatchTick(deps);

    expect(alert.note).toBe("price_unavailable");
    expect(alert.currentPriceUsd).toBeNull();
    expect(savePeak).toHaveBeenCalledWith("MISS", 2.5);
  });

  it("routes a savePeak failure to onError without skipping later positions", async () => {
    const onError = vi.fn();
    const savePeak = vi
      .fn()
      .mockRejectedValueOnce(new Error("db down"))
      .mockResolvedValue(undefined);
    const deps: ExitWatchWorkerDeps = {
      getOpenPositions: async () => [
        makeInput({ token: "A" }),
        makeInput({ token: "B" }),
      ],
      priceOf: () => 1.1,
      emitAlert: vi.fn(),
      savePeak,
      config: CONFIG,
      onError,
    };

    await runExitWatchTick(deps);

    expect(savePeak).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
  });
});

describe("setupExitWatchWorker", () => {
  it("ticks immediately, keeps polling, and stops cleanly on teardown", async () => {
    vi.useFakeTimers();
    try {
      const getOpenPositions = vi.fn(async () => [makeInput()]);
      const teardown = setupExitWatchWorker({
        getOpenPositions,
        priceOf: () => 1,
        emitAlert: vi.fn(),
        savePeak: vi.fn(),
        config: CONFIG,
        pollMs: 1000,
      });

      // Immediate first tick.
      await vi.advanceTimersByTimeAsync(0);
      expect(getOpenPositions).toHaveBeenCalledTimes(1);

      // Second tick after one interval.
      await vi.advanceTimersByTimeAsync(1000);
      expect(getOpenPositions).toHaveBeenCalledTimes(2);

      await teardown();
      const countAtStop = getOpenPositions.mock.calls.length;

      // No further ticks fire after teardown.
      await vi.advanceTimersByTimeAsync(5000);
      expect(getOpenPositions).toHaveBeenCalledTimes(countAtStop);
    } finally {
      vi.useRealTimers();
    }
  });

  it("survives a throwing tick and reports it via onError", async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const teardown = setupExitWatchWorker({
        getOpenPositions: async () => {
          throw new Error("load failed");
        },
        priceOf: () => 1,
        emitAlert: vi.fn(),
        savePeak: vi.fn(),
        config: CONFIG,
        pollMs: 1000,
        onError,
      });

      await vi.advanceTimersByTimeAsync(0);
      expect(onError).toHaveBeenCalledTimes(1);

      // Loop is still alive and re-arms for the next interval.
      await vi.advanceTimersByTimeAsync(1000);
      expect(onError).toHaveBeenCalledTimes(2);

      await teardown();
    } finally {
      vi.useRealTimers();
    }
  });
});
