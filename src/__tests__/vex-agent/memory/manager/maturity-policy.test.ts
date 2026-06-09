/**
 * Unit tests for the maturity FSM + activation-decay policy (S6a). Pure
 * decisions, no DB.
 *
 * Doctrine guards proven here:
 *  - decay is exponential half-life of days-since-reinforcement, floored at
 *    DECAY_FLOOR > 0 (influence erosion, NEVER deletion);
 *  - `none` policy is a no-op (pinned/legacy frozen);
 *  - regime_aware / outcome_aware behave as time decay in S6a (D-SCOPE-GATE);
 *  - the FSM advances on reinforcement and tips to `decayed` below the threshold,
 *    and a decayed entry is REACTIVATED (never a dead end);
 *  - the rerank activation factor is bounded in [ACTIVATION_MIN_FACTOR, 1] and the
 *    proven §7 bound holds.
 */

import { describe, it, expect } from "vitest";

import {
  ACTIVATION_HALF_LIFE_DAYS,
  ACTIVATION_MIN_FACTOR,
  ACTIVATION_MIN_FACTOR_PROVEN_BOUND,
  DECAY_FLOOR,
  DECAY_TO_DECAYED_THRESHOLD,
  REACTIVATION_ACTIVATION,
  REGIME_DWELL_MAX_GAP_HOURS,
  REGIME_MATCH_FACTOR_MAX,
  REGIME_MATCH_FACTOR_MIN,
  REGIME_MATCH_HALF_LIFE_FACTOR,
  REGIME_MISMATCH_FACTOR_MAX,
  REGIME_MISMATCH_FACTOR_MIN,
  REGIME_MISMATCH_HALF_LIFE_FACTOR,
  REGIME_SNAPSHOT_MAX_AGE_DAYS,
  REINFORCE_STEP,
  activationFactor,
  daysSince,
  decayedActivation,
  effectiveRegime,
  nextStateOnDecay,
  nextStateOnReinforce,
  regimeHalfLifeDays,
  regimeMatchKind,
  reinforceEventFor,
  reinforcedActivation,
  type EffectiveRegime,
} from "@vex-agent/memory/manager/maturity-policy.js";
import type { RegimeSnapshot } from "@vex-agent/db/repos/regime-snapshots.js";

// ── decayedActivation ─────────────────────────────────────────────

describe("decayedActivation — exponential half-life, floored, none = no-op", () => {
  it("halves activation after exactly one half-life", () => {
    expect(decayedActivation(0.8, ACTIVATION_HALF_LIFE_DAYS, "time")).toBeCloseTo(0.4, 10);
  });

  it("quarters activation after two half-lives", () => {
    expect(decayedActivation(0.8, 2 * ACTIVATION_HALF_LIFE_DAYS, "time")).toBeCloseTo(0.2, 10);
  });

  it("never erodes below DECAY_FLOOR (> 0 — never deletes)", () => {
    const decayed = decayedActivation(0.5, 100 * ACTIVATION_HALF_LIFE_DAYS, "time");
    expect(decayed).toBe(DECAY_FLOOR);
    expect(decayed).toBeGreaterThan(0);
  });

  it("is a no-op for the 'none' policy (frozen)", () => {
    expect(decayedActivation(1.0, 365, "none")).toBe(1.0);
    expect(decayedActivation(0.5, 9999, "none")).toBe(0.5);
  });

  it("treats regime_aware and outcome_aware as time decay in S6a (gated)", () => {
    const time = decayedActivation(0.8, ACTIVATION_HALF_LIFE_DAYS, "time");
    expect(decayedActivation(0.8, ACTIVATION_HALF_LIFE_DAYS, "regime_aware")).toBeCloseTo(time, 10);
    expect(decayedActivation(0.8, ACTIVATION_HALF_LIFE_DAYS, "outcome_aware")).toBeCloseTo(time, 10);
  });

  it("clamps negative days (clock skew) to no decay", () => {
    expect(decayedActivation(0.8, -10, "time")).toBeCloseTo(0.8, 10);
  });
});

// ── FSM transitions ───────────────────────────────────────────────

describe("nextStateOnReinforce — FSM advance and reactivation", () => {
  it("advances probationary → established → reinforced and caps at reinforced", () => {
    expect(nextStateOnReinforce("probationary")).toBe("established");
    expect(nextStateOnReinforce("established")).toBe("reinforced");
    expect(nextStateOnReinforce("reinforced")).toBe("reinforced");
  });

  it("reactivates a decayed entry back to established (never a dead end)", () => {
    expect(nextStateOnReinforce("decayed")).toBe("established");
  });
});

describe("reinforcedActivation — bump capped at 1.0, decayed resurrected", () => {
  it("adds REINFORCE_STEP capped at 1.0 for a non-decayed entry", () => {
    expect(reinforcedActivation(0.5, "established")).toBeCloseTo(0.5 + REINFORCE_STEP, 10);
    expect(reinforcedActivation(0.95, "reinforced")).toBe(1.0);
  });

  it("resets a decayed entry to REACTIVATION_ACTIVATION (clears the decayed threshold)", () => {
    expect(reinforcedActivation(DECAY_FLOOR, "decayed")).toBe(REACTIVATION_ACTIVATION);
    expect(REACTIVATION_ACTIVATION).toBeGreaterThan(DECAY_TO_DECAYED_THRESHOLD);
  });
});

describe("nextStateOnDecay — tips to decayed below the threshold", () => {
  it("keeps the tier above the threshold", () => {
    expect(nextStateOnDecay("established", DECAY_TO_DECAYED_THRESHOLD + 0.1)).toBe("established");
    expect(nextStateOnDecay("reinforced", 0.9)).toBe("reinforced");
  });

  it("tips any non-decayed tier to decayed at/below the threshold", () => {
    expect(nextStateOnDecay("established", DECAY_TO_DECAYED_THRESHOLD)).toBe("decayed");
    expect(nextStateOnDecay("reinforced", DECAY_FLOOR)).toBe("decayed");
    expect(nextStateOnDecay("probationary", DECAY_FLOOR)).toBe("decayed");
  });

  it("keeps an already-decayed entry decayed", () => {
    expect(nextStateOnDecay("decayed", 0.9)).toBe("decayed");
  });
});

describe("reinforceEventFor — audit event derivation", () => {
  it("maps decayed source to reactivated", () => {
    expect(reinforceEventFor("decayed", "established")).toBe("reactivated");
  });
  it("maps a tier advance to matured", () => {
    expect(reinforceEventFor("probationary", "established")).toBe("matured");
    expect(reinforceEventFor("established", "reinforced")).toBe("matured");
  });
  it("maps a same-tier reinforce to reinforced", () => {
    expect(reinforceEventFor("reinforced", "reinforced")).toBe("reinforced");
  });
});

// ── Rerank activation factor ──────────────────────────────────────

describe("activationFactor — bounded rerank multiplier (§7)", () => {
  it("maps activation 0 → MIN_FACTOR and activation 1 → 1.0", () => {
    expect(activationFactor(0)).toBeCloseTo(ACTIVATION_MIN_FACTOR, 10);
    expect(activationFactor(1)).toBeCloseTo(1.0, 10);
  });

  it("is linear between the bounds", () => {
    expect(activationFactor(0.5)).toBeCloseTo(ACTIVATION_MIN_FACTOR + (1 - ACTIVATION_MIN_FACTOR) * 0.5, 10);
  });

  it("clamps out-of-range activation into [MIN_FACTOR, 1]", () => {
    expect(activationFactor(-5)).toBeCloseTo(ACTIVATION_MIN_FACTOR, 10);
    expect(activationFactor(5)).toBeCloseTo(1.0, 10);
  });

  it("keeps MIN_FACTOR at/above the proven §7 bound", () => {
    expect(ACTIVATION_MIN_FACTOR).toBeGreaterThanOrEqual(ACTIVATION_MIN_FACTOR_PROVEN_BOUND);
  });
});

// ── daysSince ─────────────────────────────────────────────────────

describe("daysSince", () => {
  it("returns fractional days between two dates", () => {
    const now = new Date("2026-01-31T00:00:00Z");
    const ref = new Date("2026-01-01T00:00:00Z");
    expect(daysSince(ref, now)).toBeCloseTo(30, 6);
  });
  it("returns 0 for a null reference (no decay)", () => {
    expect(daysSince(null, new Date())).toBe(0);
  });
  it("clamps a future reference (clock skew) to 0", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const future = new Date("2026-02-01T00:00:00Z");
    expect(daysSince(future, now)).toBe(0);
  });
});

// ── S6b: effectiveRegime (dwell F3) ───────────────────────────────

const NOW = new Date("2026-06-10T12:00:00Z");

function snap(overrides: Partial<RegimeSnapshot> = {}): RegimeSnapshot {
  return {
    id: 2,
    trendLabel: "bull",
    volLabel: "high",
    confidence: "high",
    source: "hybrid",
    rationale: null,
    createdAt: "2026-06-10T08:00:00Z",
    ...overrides,
  };
}

/** A healthy pair: latest 4h old, previous 24h before that — gap within 48h. */
function healthyPair(
  latestOverrides: Partial<RegimeSnapshot> = {},
  prevOverrides: Partial<RegimeSnapshot> = {},
): RegimeSnapshot[] {
  return [
    snap({ id: 2, createdAt: "2026-06-10T08:00:00Z", ...latestOverrides }),
    snap({ id: 1, createdAt: "2026-06-09T08:00:00Z", ...prevOverrides }),
  ];
}

describe("effectiveRegime — dwell rule, all guards fail closed to null", () => {
  it("returns null for fewer than 2 snapshots (first day of operation)", () => {
    expect(effectiveRegime([], NOW)).toBeNull();
    expect(effectiveRegime([snap()], NOW)).toBeNull();
  });

  it("returns null when the newest snapshot is stale (worker down → degrade)", () => {
    const staleMs = NOW.getTime() - (REGIME_SNAPSHOT_MAX_AGE_DAYS * 24 + 1) * 60 * 60 * 1000;
    const pair = healthyPair({ createdAt: new Date(staleMs).toISOString() });
    // Keep the gap valid so ONLY staleness trips: previous 24h before latest.
    pair[1] = snap({ id: 1, createdAt: new Date(staleMs - 24 * 60 * 60 * 1000).toISOString() });
    expect(effectiveRegime(pair, NOW)).toBeNull();
  });

  it("returns null when the pair gap exceeds the dwell window (old snap confirms nothing)", () => {
    const gapMs = (REGIME_DWELL_MAX_GAP_HOURS + 1) * 60 * 60 * 1000;
    const latest = snap({ id: 2, createdAt: "2026-06-10T08:00:00Z" });
    const previous = snap({
      id: 1,
      createdAt: new Date(Date.parse(latest.createdAt) - gapMs).toISOString(),
    });
    expect(effectiveRegime([latest, previous], NOW)).toBeNull();
  });

  it("returns null on an unparseable timestamp (corrupt row → fail closed)", () => {
    expect(effectiveRegime(healthyPair({ createdAt: "not-a-date" }), NOW)).toBeNull();
  });

  it("agreeing axes carry their value; the latest snapshot's id is the trigger ref", () => {
    const eff = effectiveRegime(healthyPair(), NOW);
    expect(eff).toEqual({ trend: "bull", vol: "high", confidence: "high", snapshotId: 2 });
  });

  it("a disagreeing axis resolves to 'unknown' (neutral) per axis, independently", () => {
    const eff = effectiveRegime(healthyPair({ trendLabel: "bear" }, { trendLabel: "bull" }), NOW);
    expect(eff?.trend).toBe("unknown"); // disagreement → no influence from this axis
    expect(eff?.vol).toBe("high"); // the other axis still agrees
  });

  it("confidence is the MIN of the pair (two-day corroboration, not clipping)", () => {
    expect(effectiveRegime(healthyPair({ confidence: "high" }, { confidence: "low" }), NOW)?.confidence).toBe("low");
    expect(effectiveRegime(healthyPair({ confidence: "medium" }, { confidence: "high" }), NOW)?.confidence).toBe("medium");
  });

  it("tolerates a mis-ordered pair (defensive re-sort by createdAt)", () => {
    const pair = healthyPair();
    const eff = effectiveRegime([pair[1]!, pair[0]!], NOW);
    expect(eff?.snapshotId).toBe(2); // still the genuinely-latest snapshot
  });
});

// ── S6b: regimeMatchKind aggregation matrix ───────────────────────

function eff(overrides: Partial<EffectiveRegime> = {}): EffectiveRegime {
  return { trend: "bull", vol: "high", confidence: "high", snapshotId: 1, ...overrides };
}

describe("regimeMatchKind — conservative aggregation", () => {
  it("≥1 match and 0 mismatches → match", () => {
    expect(regimeMatchKind(["bull"], eff())).toBe("match");
    expect(regimeMatchKind(["bull", "high_vol"], eff())).toBe("match");
  });

  it("≥1 mismatch and 0 matches → mismatch", () => {
    expect(regimeMatchKind(["bear"], eff())).toBe("mismatch");
    expect(regimeMatchKind(["bear", "low_vol"], eff())).toBe("mismatch");
  });

  it("mixed (a match AND a mismatch) → neutral", () => {
    expect(regimeMatchKind(["bull", "low_vol"], eff())).toBe("neutral");
  });

  it("empty tags → neutral (timeless lesson)", () => {
    expect(regimeMatchKind([], eff())).toBe("neutral");
  });

  it("an 'unknown' snapshot axis neutralizes its tags", () => {
    expect(regimeMatchKind(["bull"], eff({ trend: "unknown" }))).toBe("neutral");
    // The OTHER axis still decides when it is known.
    expect(regimeMatchKind(["bull", "high_vol"], eff({ trend: "unknown" }))).toBe("match");
    expect(regimeMatchKind(["bull", "low_vol"], eff({ trend: "unknown" }))).toBe("mismatch");
  });

  it("'low' effective confidence is ALWAYS neutral (F4: recorded, zero influence)", () => {
    expect(regimeMatchKind(["bull"], eff({ confidence: "low" }))).toBe("neutral");
    expect(regimeMatchKind(["bear"], eff({ confidence: "low" }))).toBe("neutral");
  });

  it("an out-of-vocab legacy tag is skipped (neutral, fail-closed)", () => {
    expect(regimeMatchKind(["bull_microcap"], eff())).toBe("neutral");
    expect(regimeMatchKind(["bull_microcap", "bull"], eff())).toBe("match");
  });
});

// ── S6b: regimeHalfLifeDays + hard factor bounds ──────────────────

describe("regimeHalfLifeDays + factor bounds (F4)", () => {
  it("neutral → base 30d, match → 60d, mismatch → 15d (at the shipped factors)", () => {
    expect(regimeHalfLifeDays("neutral")).toBe(ACTIVATION_HALF_LIFE_DAYS);
    expect(regimeHalfLifeDays("match")).toBe(ACTIVATION_HALF_LIFE_DAYS * REGIME_MATCH_HALF_LIFE_FACTOR);
    expect(regimeHalfLifeDays("mismatch")).toBe(ACTIVATION_HALF_LIFE_DAYS * REGIME_MISMATCH_HALF_LIFE_FACTOR);
  });

  it("the shipped factors sit inside the import-asserted hard bounds", () => {
    // Mirrors the import-time assert: an edit outside these bounds fails at
    // module load; this pins the bounds themselves against silent loosening.
    expect(REGIME_MISMATCH_HALF_LIFE_FACTOR).toBeGreaterThanOrEqual(REGIME_MISMATCH_FACTOR_MIN);
    expect(REGIME_MISMATCH_HALF_LIFE_FACTOR).toBeLessThanOrEqual(REGIME_MISMATCH_FACTOR_MAX);
    expect(REGIME_MATCH_HALF_LIFE_FACTOR).toBeGreaterThanOrEqual(REGIME_MATCH_FACTOR_MIN);
    expect(REGIME_MATCH_HALF_LIFE_FACTOR).toBeLessThanOrEqual(REGIME_MATCH_FACTOR_MAX);
    expect(REGIME_MISMATCH_FACTOR_MIN).toBe(0.25);
    expect(REGIME_MISMATCH_FACTOR_MAX).toBe(1);
    expect(REGIME_MATCH_FACTOR_MIN).toBe(1);
    expect(REGIME_MATCH_FACTOR_MAX).toBe(4);
  });

  it("property: for every match kind and any horizon, modulated decay stays in [DECAY_FLOOR, activation] — never zero-decay below the floor, never deletion", () => {
    for (const kind of ["match", "mismatch", "neutral"] as const) {
      const halfLife = regimeHalfLifeDays(kind);
      expect(halfLife).toBeGreaterThan(0);
      for (const days of [0, 1, 7, 30, 60, 365, 10_000]) {
        for (const activation of [DECAY_FLOOR, 0.2, 0.5, 1.0]) {
          const decayed = decayedActivation(activation, days, "regime_aware", halfLife);
          expect(decayed).toBeGreaterThanOrEqual(DECAY_FLOOR); // never deletes
          expect(decayed).toBeLessThanOrEqual(Math.max(activation, DECAY_FLOOR)); // never increases
        }
      }
    }
  });
});

// ── S6b: decayedActivation 4th-parameter compatibility ────────────

describe("decayedActivation — optional halfLifeDays parameter", () => {
  it("omitting the parameter is bit-for-bit the S6a default half-life", () => {
    expect(decayedActivation(0.8, 30, "time")).toBe(
      decayedActivation(0.8, 30, "time", ACTIVATION_HALF_LIFE_DAYS),
    );
  });

  it("a longer half-life decays slower, a shorter one faster", () => {
    const base = decayedActivation(0.8, 30, "regime_aware");
    expect(decayedActivation(0.8, 30, "regime_aware", 60)).toBeGreaterThan(base);
    expect(decayedActivation(0.8, 30, "regime_aware", 15)).toBeLessThan(base);
  });

  it("a non-positive/non-finite half-life falls back to the default (defensive)", () => {
    const base = decayedActivation(0.8, 30, "time");
    expect(decayedActivation(0.8, 30, "time", 0)).toBe(base);
    expect(decayedActivation(0.8, 30, "time", Number.NaN)).toBe(base);
  });
});
