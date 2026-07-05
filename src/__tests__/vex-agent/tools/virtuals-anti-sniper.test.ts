import { describe, expect, it } from "vitest";
import {
  ANTI_SNIPER_DURATION_SECONDS,
  computeAntiSniper,
} from "../../../vex-agent/tools/protocols/virtuals/anti-sniper.js";

const LP = "2026-07-03T00:00:00.000Z";
const LP_MS = Date.parse(LP);
const at = (secondsAfterGraduation: number) => LP_MS + secondsAfterGraduation * 1000;

describe("computeAntiSniper", () => {
  it("pre-graduation (no lpCreatedAt) is not applicable and taxes null", () => {
    const s = computeAntiSniper(1, null, at(0));
    expect(s.applicable).toBe(false);
    expect(s.windowActive).toBe(false);
    expect(s.remainingSeconds).toBe(0);
    expect(s.estBuyTaxPct).toBeNull();
  });

  it("null taxType is not applicable", () => {
    const s = computeAntiSniper(null, LP, at(5));
    expect(s.applicable).toBe(false);
    expect(s.estBuyTaxPct).toBeNull();
  });

  it("type 0 (no window): applicable but never active, residual flat ~1% tax", () => {
    const s = computeAntiSniper(0, LP, at(1));
    expect(s.durationSeconds).toBe(0);
    expect(s.applicable).toBe(true);
    expect(s.windowActive).toBe(false);
    expect(s.estBuyTaxPct).toBe(1);
  });

  it("type 1 (60s): active at graduation with ~100% tax", () => {
    const s = computeAntiSniper(1, LP, at(0));
    expect(s.durationSeconds).toBe(60);
    expect(s.windowActive).toBe(true);
    expect(s.remainingSeconds).toBe(60);
    // 99 * (60/60) + 1 = 100
    expect(s.estBuyTaxPct).toBe(100);
  });

  it("type 1: halfway through the window taxes ~50.5%", () => {
    const s = computeAntiSniper(1, LP, at(30));
    expect(s.windowActive).toBe(true);
    expect(s.remainingSeconds).toBe(30);
    // 99 * (30/60) + 1 = 50.5
    expect(s.estBuyTaxPct).toBe(50.5);
  });

  it("type 1: at the exact boundary the window is closed (residual flat)", () => {
    const s = computeAntiSniper(1, LP, at(60));
    expect(s.windowActive).toBe(false);
    expect(s.remainingSeconds).toBe(0);
    expect(s.estBuyTaxPct).toBe(1);
  });

  it("type 1: well past the window is inactive", () => {
    const s = computeAntiSniper(1, LP, at(120));
    expect(s.windowActive).toBe(false);
    expect(s.estBuyTaxPct).toBe(1);
  });

  it("type 2 (5880s): decays linearly over the longer window", () => {
    expect(ANTI_SNIPER_DURATION_SECONDS[2]).toBe(5880);
    const half = computeAntiSniper(2, LP, at(2940)); // 50% elapsed
    expect(half.windowActive).toBe(true);
    expect(half.estBuyTaxPct).toBe(50.5);
    const nearEnd = computeAntiSniper(2, LP, at(5879));
    expect(nearEnd.windowActive).toBe(true);
    expect(nearEnd.estBuyTaxPct).toBeLessThan(2);
  });

  it("unknown finite type (future API drift) degrades to not-applicable/unknown — NEVER 'flat tax, safe to buy'", () => {
    for (const unknownType of [3, 7, -1, 2.5]) {
      const s = computeAntiSniper(unknownType, LP, at(30));
      expect(s.type).toBeNull();
      expect(s.applicable).toBe(false);
      expect(s.windowActive).toBe(false);
      expect(s.estBuyTaxPct).toBeNull();
    }
  });
});
