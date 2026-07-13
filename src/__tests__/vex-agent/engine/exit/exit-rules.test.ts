/**
 * Exit rules — take-profit / stop-loss / trailing / time-stop coverage.
 *
 * Phase B TDD suite. Pins the decision semantics (priority order, boundaries,
 * idempotency, cumulative-fraction clamping, defensive totality) so a change
 * to the exit logic surfaces as a named failing test rather than silent
 * capital-management drift.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateExit,
  type ExitConfig,
  type Position,
} from "@vex-agent/engine/exit/exit-rules.js";

/** Ladder: 2x sells 50% of original, 3x sells another 50%. */
const LADDER = [
  { multiple: 2, sellFraction: 0.5 },
  { multiple: 3, sellFraction: 0.5 },
] as const;

const BASE_CONFIG: ExitConfig = {
  takeProfitLadder: LADDER,
  stopLossPct: 0.35,
  trailingStopPct: 0.25,
  timeStopMinutes: 240,
  timeStopFlatBandPct: 0.15,
};

const OPENED_AT = 1_000_000;

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    token: "So11111111111111111111111111111111111111112",
    entryPriceUsd: 1,
    amountTokens: 1000,
    peakPriceUsd: 1,
    openedAtMs: OPENED_AT,
    consumedRungs: [],
    ...overrides,
  };
}

/** nowMs still inside every time window (well under timeStopMinutes). */
const NOW_EARLY = OPENED_AT + 60_000;

describe("evaluateExit — ordinary hold", () => {
  it("returns [] when price sits between entry and the first rung", () => {
    const pos = makePosition({ peakPriceUsd: 1.4 });
    expect(evaluateExit(pos, 1.3, NOW_EARLY, BASE_CONFIG)).toEqual([]);
  });
});

describe("evaluateExit — stop_loss", () => {
  it("fires AT the threshold (price == entry * (1 - stopLossPct))", () => {
    const pos = makePosition();
    const out = evaluateExit(pos, 0.65, NOW_EARLY, BASE_CONFIG); // -35% exactly
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("stop_loss");
    expect(out[0].sellFraction).toBe(1);
  });

  it("fires PAST the threshold and sells the whole remaining position", () => {
    const pos = makePosition();
    const out = evaluateExit(pos, 0.5, NOW_EARLY, BASE_CONFIG); // -50%
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("stop_loss");
    expect(out[0].sellFraction).toBe(1);
  });

  it("does NOT fire just above the threshold (boundary)", () => {
    const pos = makePosition();
    const out = evaluateExit(pos, 0.66, NOW_EARLY, BASE_CONFIG); // -34%
    expect(out).toEqual([]);
  });

  it("sells only the remaining fraction after a rung was already consumed", () => {
    const pos = makePosition({ consumedRungs: [0] }); // 50% already sold at 2x
    const out = evaluateExit(pos, 0.5, NOW_EARLY, BASE_CONFIG);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("stop_loss");
    expect(out[0].sellFraction).toBeCloseTo(0.5, 10);
  });
});

describe("evaluateExit — take_profit", () => {
  it("fires a single rung AT its multiple (price == entry * multiple)", () => {
    const pos = makePosition({ peakPriceUsd: 2 });
    const out = evaluateExit(pos, 2, NOW_EARLY, BASE_CONFIG);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("take_profit");
    expect(out[0].rungIndex).toBe(0);
    expect(out[0].sellFraction).toBe(0.5);
  });

  it("does NOT fire a rung just below its multiple", () => {
    const pos = makePosition({ peakPriceUsd: 1.99 });
    const out = evaluateExit(pos, 1.99, NOW_EARLY, BASE_CONFIG);
    expect(out).toEqual([]);
  });

  it("fires two rungs on one tick when a candle blows past both, ascending", () => {
    const pos = makePosition({ peakPriceUsd: 3.5 });
    const out = evaluateExit(pos, 3.5, NOW_EARLY, BASE_CONFIG);
    expect(out).toHaveLength(2);
    expect(out.map((d) => d.kind)).toEqual(["take_profit", "take_profit"]);
    expect(out.map((d) => d.rungIndex)).toEqual([0, 1]);
    expect(out.map((d) => d.sellFraction)).toEqual([0.5, 0.5]);
  });

  it("skips a rung already listed in consumedRungs (idempotency)", () => {
    const pos = makePosition({ peakPriceUsd: 3.5, consumedRungs: [0] });
    const out = evaluateExit(pos, 3.5, NOW_EARLY, BASE_CONFIG);
    expect(out).toHaveLength(1);
    expect(out[0].rungIndex).toBe(1);
    expect(out[0].sellFraction).toBe(0.5);
  });

  it("clamps the last rung so cumulative sold fraction never exceeds 1", () => {
    const greedyLadder = {
      ...BASE_CONFIG,
      takeProfitLadder: [
        { multiple: 2, sellFraction: 0.7 },
        { multiple: 3, sellFraction: 0.7 }, // 0.7 + 0.7 = 1.4 > 1
      ],
    } satisfies ExitConfig;
    const pos = makePosition({ peakPriceUsd: 3.5 });
    const out = evaluateExit(pos, 3.5, NOW_EARLY, greedyLadder);
    expect(out).toHaveLength(2);
    expect(out[0].sellFraction).toBeCloseTo(0.7, 10);
    expect(out[1].sellFraction).toBeCloseTo(0.3, 10); // clamped from 0.7
    const total = out.reduce((s, d) => s + d.sellFraction, 0);
    expect(total).toBeCloseTo(1, 10);
  });

  it("respects fraction already consumed when clamping new rungs", () => {
    const greedyLadder = {
      ...BASE_CONFIG,
      takeProfitLadder: [
        { multiple: 2, sellFraction: 0.8 },
        { multiple: 3, sellFraction: 0.8 },
      ],
    } satisfies ExitConfig;
    // rung 0 (0.8) already sold; only 0.2 capacity remains for rung 1.
    const pos = makePosition({ peakPriceUsd: 3.5, consumedRungs: [0] });
    const out = evaluateExit(pos, 3.5, NOW_EARLY, greedyLadder);
    expect(out).toHaveLength(1);
    expect(out[0].rungIndex).toBe(1);
    expect(out[0].sellFraction).toBeCloseTo(0.2, 10);
  });
});

describe("evaluateExit — trailing_stop", () => {
  it("does NOT fire before any rung is consumed, even past the drawdown", () => {
    const pos = makePosition({ peakPriceUsd: 4, consumedRungs: [] });
    // price 2.5 is 37.5% below peak (> 25%) but no rung consumed yet.
    const out = evaluateExit(pos, 2.5, NOW_EARLY, BASE_CONFIG);
    expect(out.some((d) => d.kind === "trailing_stop")).toBe(false);
  });

  it("fires once a rung is consumed and price falls trailingStopPct below peak", () => {
    const pos = makePosition({ peakPriceUsd: 4, consumedRungs: [0] });
    const out = evaluateExit(pos, 2.5, NOW_EARLY, BASE_CONFIG); // -37.5% from peak
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("trailing_stop");
    expect(out[0].sellFraction).toBeCloseTo(0.5, 10); // remaining after rung 0
  });

  it("fires exactly AT the peak-drawdown boundary", () => {
    const pos = makePosition({ peakPriceUsd: 4, consumedRungs: [0] });
    const out = evaluateExit(pos, 3, NOW_EARLY, BASE_CONFIG); // 4 * (1 - 0.25) = 3
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("trailing_stop");
  });

  it("does NOT fire just inside the peak-drawdown boundary", () => {
    const pos = makePosition({ peakPriceUsd: 4, consumedRungs: [0] });
    const out = evaluateExit(pos, 3.01, NOW_EARLY, BASE_CONFIG);
    expect(out.some((d) => d.kind === "trailing_stop")).toBe(false);
  });

  it("is disabled when trailingStopPct is undefined", () => {
    const cfg = { ...BASE_CONFIG, trailingStopPct: undefined };
    const pos = makePosition({ peakPriceUsd: 4, consumedRungs: [0] });
    const out = evaluateExit(pos, 2.5, NOW_EARLY, cfg);
    expect(out.some((d) => d.kind === "trailing_stop")).toBe(false);
  });
});

describe("evaluateExit — time_stop", () => {
  const NOW_LATE = OPENED_AT + 240 * 60_000; // exactly timeStopMinutes later

  it("fires when flat AND past the time window", () => {
    const pos = makePosition();
    const out = evaluateExit(pos, 1.05, NOW_LATE, BASE_CONFIG); // +5%, within ±15%
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("time_stop");
    expect(out[0].sellFraction).toBe(1);
  });

  it("does NOT fire before the time window even if flat", () => {
    const pos = makePosition();
    const out = evaluateExit(pos, 1.05, NOW_EARLY, BASE_CONFIG);
    expect(out).toEqual([]);
  });

  it("does NOT fire when price is outside the flat band (in profit)", () => {
    const pos = makePosition({ peakPriceUsd: 1.2 });
    const out = evaluateExit(pos, 1.2, NOW_LATE, BASE_CONFIG); // +20% > 15%
    expect(out.some((d) => d.kind === "time_stop")).toBe(false);
  });

  it("does NOT fire when price is below the flat band but above stop-loss", () => {
    const pos = makePosition();
    const out = evaluateExit(pos, 0.8, NOW_LATE, BASE_CONFIG); // -20%, band is ±15%
    expect(out).toEqual([]);
  });

  it("sells only the remaining fraction after a consumed rung", () => {
    const pos = makePosition({ consumedRungs: [0] });
    const out = evaluateExit(pos, 1.0, NOW_LATE, BASE_CONFIG);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("time_stop");
    expect(out[0].sellFraction).toBeCloseTo(0.5, 10);
  });
});

describe("evaluateExit — priority", () => {
  it("fires ONLY stop_loss when both stop_loss and a TP rung qualify", () => {
    // Contrived config where the same price is both below stop and above a rung
    // is impossible on a monotonic ladder; instead assert stop_loss wins when a
    // low rung sits under the stop threshold conceptually is N/A. Use the real
    // case: crashed price with a consumed rung — stop must win over trailing/TP.
    const cfg = {
      ...BASE_CONFIG,
      takeProfitLadder: [{ multiple: 0.5, sellFraction: 0.5 }], // arms below entry
      stopLossPct: 0.35,
    } satisfies ExitConfig;
    const pos = makePosition({ peakPriceUsd: 1 });
    const out = evaluateExit(pos, 0.6, NOW_EARLY, cfg); // -40%: stop hit; also >= 0.5x rung
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("stop_loss");
  });

  it("fires ONLY stop_loss (not trailing) when both would qualify", () => {
    const pos = makePosition({ peakPriceUsd: 4, consumedRungs: [0] });
    // 0.6 is < entry*0.65 (stop) AND < peak*0.75 (trailing). Stop wins.
    const out = evaluateExit(pos, 0.6, NOW_EARLY, BASE_CONFIG);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("stop_loss");
  });

  it("fires trailing_stop (not time_stop) when both could qualify", () => {
    const NOW_LATE = OPENED_AT + 240 * 60_000;
    // Price flat-ish AND late (time-stop eligible) but also a consumed rung with
    // deep peak drawdown → trailing must win.
    const pos = makePosition({ peakPriceUsd: 1.15, consumedRungs: [0] });
    const cfg = { ...BASE_CONFIG, trailingStopPct: 0.1 };
    const out = evaluateExit(pos, 1.0, NOW_LATE, cfg); // 1.0 <= 1.15*0.9=1.035 trailing; within band
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("trailing_stop");
  });

  it("fires take_profit (not time_stop) when both could qualify", () => {
    const NOW_LATE = OPENED_AT + 240 * 60_000;
    const pos = makePosition({ peakPriceUsd: 2 });
    // At 2x the price is outside the flat band anyway, but assert TP wins.
    const out = evaluateExit(pos, 2, NOW_LATE, BASE_CONFIG);
    expect(out.every((d) => d.kind === "take_profit")).toBe(true);
    expect(out.some((d) => d.kind === "time_stop")).toBe(false);
  });
});

describe("evaluateExit — defensive totality", () => {
  it("returns [] for a non-positive current price", () => {
    expect(evaluateExit(makePosition(), 0, NOW_EARLY, BASE_CONFIG)).toEqual([]);
    expect(evaluateExit(makePosition(), -5, NOW_EARLY, BASE_CONFIG)).toEqual([]);
  });

  it("returns [] for a NaN / non-finite current price", () => {
    expect(evaluateExit(makePosition(), NaN, NOW_EARLY, BASE_CONFIG)).toEqual([]);
    expect(evaluateExit(makePosition(), Infinity, NOW_EARLY, BASE_CONFIG)).toEqual([]);
  });

  it("returns [] for a non-positive / non-finite entry price", () => {
    expect(evaluateExit(makePosition({ entryPriceUsd: 0 }), 1, NOW_EARLY, BASE_CONFIG)).toEqual([]);
    expect(
      evaluateExit(makePosition({ entryPriceUsd: NaN }), 1, NOW_EARLY, BASE_CONFIG),
    ).toEqual([]);
  });

  it("does not throw and returns [] when the position is fully consumed", () => {
    const pos = makePosition({ consumedRungs: [0, 1] }); // 100% already sold
    // Even a stop-loss price has nothing left to sell.
    expect(evaluateExit(pos, 0.5, NOW_EARLY, BASE_CONFIG)).toEqual([]);
  });
});
