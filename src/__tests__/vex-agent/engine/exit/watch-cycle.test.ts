/**
 * Watch cycle — per-tick peak refresh + evaluateExit orchestration coverage.
 *
 * Phase C TDD suite. Pins the pure cycle semantics: high-water tracking,
 * decision surfacing, price-lookup degradation, per-position independence,
 * and consumedRungs threading.
 */

import { describe, it, expect } from "vitest";
import {
  runWatchCycle,
  type WatchInputPosition,
} from "@vex-agent/engine/exit/watch-cycle.js";
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
const NOW_EARLY = OPENED_AT + 60_000;

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

/** priceOf that always returns a fixed price. */
function fixedPrice(p: number | null | undefined): (token: string) => number | null | undefined {
  return () => p;
}

describe("runWatchCycle — empty input", () => {
  it("returns [] for no positions", () => {
    expect(runWatchCycle([], fixedPrice(1), NOW_EARLY, CONFIG)).toEqual([]);
  });
});

describe("runWatchCycle — peak tracking", () => {
  it("raises the peak when price makes a new high", () => {
    const pos = makeInput({ priorPeakPriceUsd: 2 });
    const [alert] = runWatchCycle([pos], fixedPrice(3), NOW_EARLY, CONFIG);
    expect(alert.updatedPeakPriceUsd).toBe(3);
    expect(alert.currentPriceUsd).toBe(3);
  });

  it("keeps the peak sticky when price dips below the prior high", () => {
    const pos = makeInput({ priorPeakPriceUsd: 3 });
    const [alert] = runWatchCycle([pos], fixedPrice(2), NOW_EARLY, CONFIG);
    expect(alert.updatedPeakPriceUsd).toBe(3);
    expect(alert.currentPriceUsd).toBe(2);
  });
});

describe("runWatchCycle — decision surfacing", () => {
  it("surfaces a take-profit rung when price crosses a multiple", () => {
    const pos = makeInput({ priorPeakPriceUsd: 1.5 });
    const [alert] = runWatchCycle([pos], fixedPrice(2), NOW_EARLY, CONFIG);
    expect(alert.updatedPeakPriceUsd).toBe(2);
    expect(alert.decisions).toHaveLength(1);
    expect(alert.decisions[0].kind).toBe("take_profit");
    expect(alert.decisions[0].rungIndex).toBe(0);
  });

  it("surfaces a stop-loss when price crashes below the stop threshold", () => {
    const pos = makeInput();
    const [alert] = runWatchCycle([pos], fixedPrice(0.5), NOW_EARLY, CONFIG);
    expect(alert.decisions).toHaveLength(1);
    expect(alert.decisions[0].kind).toBe("stop_loss");
    expect(alert.decisions[0].sellFraction).toBe(1);
  });

  it("returns no decisions on an ordinary hold", () => {
    const pos = makeInput({ priorPeakPriceUsd: 1.4 });
    const [alert] = runWatchCycle([pos], fixedPrice(1.3), NOW_EARLY, CONFIG);
    expect(alert.decisions).toEqual([]);
    expect(alert.note).toBeUndefined();
  });
});

describe("runWatchCycle — trailing depends on consumed rungs", () => {
  it("does NOT surface trailing before any rung is consumed", () => {
    // priorPeak 4, price 2.5 = -37.5% from peak (past 25%) but nothing consumed.
    const pos = makeInput({ priorPeakPriceUsd: 4, consumedRungs: [] });
    const [alert] = runWatchCycle([pos], fixedPrice(2.5), NOW_EARLY, CONFIG);
    expect(alert.decisions.some((d) => d.kind === "trailing_stop")).toBe(false);
  });

  it("surfaces trailing once a rung is consumed and price falls below peak drawdown", () => {
    const pos = makeInput({ priorPeakPriceUsd: 4, consumedRungs: [0] });
    const [alert] = runWatchCycle([pos], fixedPrice(2.5), NOW_EARLY, CONFIG);
    expect(alert.decisions).toHaveLength(1);
    expect(alert.decisions[0].kind).toBe("trailing_stop");
    expect(alert.decisions[0].sellFraction).toBeCloseTo(0.5, 10);
  });
});

describe("runWatchCycle — consumedRungs threading", () => {
  it("threads consumedRungs into evaluateExit so a consumed rung is skipped", () => {
    // Price at 3x would fire rungs 0 and 1, but rung 0 is already consumed.
    const pos = makeInput({ priorPeakPriceUsd: 3, consumedRungs: [0] });
    const [alert] = runWatchCycle([pos], fixedPrice(3), NOW_EARLY, CONFIG);
    expect(alert.decisions).toHaveLength(1);
    expect(alert.decisions[0].rungIndex).toBe(1);
  });
});

describe("runWatchCycle — price unavailable", () => {
  it("emits a price_unavailable alert with null price and [] when lookup returns null", () => {
    const pos = makeInput({ priorPeakPriceUsd: 2.5 });
    const [alert] = runWatchCycle([pos], fixedPrice(null), NOW_EARLY, CONFIG);
    expect(alert.currentPriceUsd).toBeNull();
    expect(alert.decisions).toEqual([]);
    expect(alert.note).toBe("price_unavailable");
    // Peak is carried unchanged when the price is unknown.
    expect(alert.updatedPeakPriceUsd).toBe(2.5);
  });

  it("treats undefined / NaN / non-positive prices as unavailable", () => {
    const pos = makeInput();
    for (const bad of [undefined, NaN, Infinity, 0, -3]) {
      const [alert] = runWatchCycle(
        [pos],
        fixedPrice(bad as number | null | undefined),
        NOW_EARLY,
        CONFIG,
      );
      expect(alert.currentPriceUsd, `price ${String(bad)}`).toBeNull();
      expect(alert.note, `price ${String(bad)}`).toBe("price_unavailable");
    }
  });

  it("does not throw when priceOf itself throws — degrades to unavailable", () => {
    const pos = makeInput();
    const throwing = (): number => {
      throw new Error("rpc down");
    };
    const run = () => runWatchCycle([pos], throwing, NOW_EARLY, CONFIG);
    expect(run).not.toThrow();
    const [alert] = run();
    expect(alert.currentPriceUsd).toBeNull();
    expect(alert.note).toBe("price_unavailable");
  });
});

describe("runWatchCycle — multiple positions independent", () => {
  it("evaluates each position independently and preserves order", () => {
    const winner = makeInput({ token: "WIN", priorPeakPriceUsd: 1.5 });
    const loser = makeInput({ token: "LOSE" });
    const missing = makeInput({ token: "MISS" });
    const priceOf = (token: string): number | null => {
      if (token === "WIN") return 2; // hits TP rung 0
      if (token === "LOSE") return 0.5; // hits stop-loss
      return null; // MISS → unavailable
    };
    const alerts = runWatchCycle([winner, loser, missing], priceOf, NOW_EARLY, CONFIG);
    expect(alerts.map((a) => a.token)).toEqual(["WIN", "LOSE", "MISS"]);
    expect(alerts[0].decisions[0].kind).toBe("take_profit");
    expect(alerts[1].decisions[0].kind).toBe("stop_loss");
    expect(alerts[2].note).toBe("price_unavailable");
    expect(alerts[2].currentPriceUsd).toBeNull();
  });
});
