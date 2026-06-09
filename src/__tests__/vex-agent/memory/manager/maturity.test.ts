/**
 * Unit tests for the maturity FSM application shell (S6a + S6b): reinforceEntry
 * + decayEntry. IO is stubbed (no DB) — these prove the orchestration:
 *  - reinforcement bumps activation + advances the FSM + bumps last_reinforced_at
 *    + records ONE audit row with reason recurrence_confirmation;
 *  - a decayed entry is reactivated (decayed → established, event reactivated);
 *  - decay erodes activation, never deletes, tips to decayed below the threshold,
 *    records reason time_decay, and does NOT bump last_reinforced_at;
 *  - anti audit-spam: a sub-delta decay with no tier change is a no-op (no write,
 *    no audit);
 *  - a precondition miss writes no audit row (no phantom audit / lost update);
 *  - S6b regime modulation: mismatch erodes on the 15d half-life, match on 60d,
 *    neutral on 30d; regime === null is bit-for-bit S6a; the floor always holds;
 *    regime-driven reactivation fires ONLY for decayed+match+high and writes the
 *    `reactivated`/`regime_decay` audit row with the snapshot id.
 */

import { describe, it, expect, vi } from "vitest";

import {
  reinforceEntry,
  decayEntry,
  DECAY_AUDIT_MIN_DELTA,
  type MaturityDeps,
} from "@vex-agent/memory/manager/maturity.js";
import {
  ACTIVATION_HALF_LIFE_DAYS,
  DECAY_FLOOR,
  REACTIVATION_ACTIVATION,
  REGIME_MATCH_HALF_LIFE_FACTOR,
  REGIME_MISMATCH_HALF_LIFE_FACTOR,
  REINFORCE_STEP,
  type EffectiveRegime,
} from "@vex-agent/memory/manager/maturity-policy.js";
import type { MaturityEntryRow } from "@vex-agent/db/repos/knowledge/crud.js";

// A fake PoolClient — the stubbed deps never touch it.
const TX = {} as never;

function makeEntry(overrides: Partial<MaturityEntryRow> = {}): MaturityEntryRow {
  return {
    id: 42,
    maturityState: "probationary",
    activationStrength: 0.5,
    decayPolicy: "regime_aware",
    regimeTags: [],
    firstPromotedAt: "2026-01-01T00:00:00Z",
    lastReinforcedAt: "2026-01-01T00:00:00Z",
    lastDecayedAt: null,
    ...overrides,
  };
}

function makeRegime(overrides: Partial<EffectiveRegime> = {}): EffectiveRegime {
  return {
    trend: "bull",
    vol: "high",
    confidence: "high",
    snapshotId: 99,
    ...overrides,
  };
}

function makeDeps(entry: MaturityEntryRow | null, transitionOk = true): {
  deps: MaturityDeps;
  apply: ReturnType<typeof vi.fn>;
  audit: ReturnType<typeof vi.fn>;
} {
  const apply = vi.fn().mockResolvedValue(transitionOk);
  const audit = vi.fn().mockResolvedValue({ id: "1" });
  const deps: MaturityDeps = {
    getMaturityEntry: vi.fn().mockResolvedValue(entry),
    applyMaturityTransition: apply as unknown as MaturityDeps["applyMaturityTransition"],
    recordMaturityEvent: audit as unknown as MaturityDeps["recordMaturityEvent"],
  };
  return { deps, apply, audit };
}

// ── reinforceEntry ────────────────────────────────────────────────

describe("reinforceEntry — recurrence reinforcement", () => {
  it("matures probationary → established, bumps activation + last_reinforced_at, audits", async () => {
    const { deps, apply, audit } = makeDeps(makeEntry({ maturityState: "probationary", activationStrength: 0.5 }));
    const result = await reinforceEntry(7, { candidateId: "11111111-1111-1111-1111-111111111111" }, TX, deps);

    expect(result).toMatchObject({ ok: true, applied: true, fromState: "probationary", toState: "established" });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        nextMaturityState: "established",
        nextActivation: 0.5 + REINFORCE_STEP,
        bumpLastReinforcedAt: true,
      }),
      TX,
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "matured",
        reasonCode: "recurrence_confirmation",
        triggerRefs: { candidateId: "11111111-1111-1111-1111-111111111111" },
      }),
      TX,
    );
  });

  it("reactivates a decayed entry → established with event reactivated", async () => {
    const { deps, apply, audit } = makeDeps(makeEntry({ maturityState: "decayed", activationStrength: DECAY_FLOOR }));
    const result = await reinforceEntry(7, {}, TX, deps);

    expect(result).toMatchObject({ ok: true, applied: true, fromState: "decayed", toState: "established" });
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ nextMaturityState: "established", nextActivation: REACTIVATION_ACTIVATION }),
      TX,
    );
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "reactivated" }), TX);
  });

  it("records reinforced (no tier change) at the top tier", async () => {
    const { deps, audit } = makeDeps(makeEntry({ maturityState: "reinforced", activationStrength: 0.9 }));
    await reinforceEntry(7, {}, TX, deps);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "reinforced" }), TX);
  });

  it("no-ops without an audit row when the entry is absent/non-active", async () => {
    const { deps, apply, audit } = makeDeps(null);
    const result = await reinforceEntry(7, {}, TX, deps);
    expect(result).toEqual({ ok: true, applied: false, reason: "not_found" });
    expect(apply).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("no-ops without an audit row on a precondition miss (concurrent transition)", async () => {
    const { deps, audit } = makeDeps(makeEntry(), /* transitionOk */ false);
    const result = await reinforceEntry(7, {}, TX, deps);
    expect(result).toEqual({ ok: true, applied: false, reason: "precondition_miss" });
    expect(audit).not.toHaveBeenCalled();
  });
});

// ── decayEntry ────────────────────────────────────────────────────

describe("decayEntry — time decay (erode, never delete)", () => {
  const NOW = new Date("2026-01-31T00:00:00Z"); // 30 days after the entry's last_reinforced_at

  it("erodes activation by one half-life, records reason time_decay, does NOT bump last_reinforced_at", async () => {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.8 });
    // 30 days ≈ one half-life → 0.4.
    const reinforced = new Date(NOW.getTime() - ACTIVATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    entry.lastReinforcedAt = reinforced.toISOString();

    const { deps, apply, audit } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, null, TX, deps);

    expect(result).toMatchObject({ ok: true, applied: true });
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBeCloseTo(0.4, 6);
    }
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ bumpLastReinforcedAt: false }), TX);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "decayed", reasonCode: "time_decay" }),
      TX,
    );
  });

  it("never erodes below DECAY_FLOOR and never deletes (floor invariant)", async () => {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.5 });
    const ancient = new Date(NOW.getTime() - 1000 * ACTIVATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    entry.lastReinforcedAt = ancient.toISOString();

    const { deps } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, null, TX, deps);
    expect(result.ok).toBe(true);
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBe(DECAY_FLOOR);
      expect(result.activationAfter).toBeGreaterThan(0);
    }
  });

  it("tips to decayed and audits the tier change", async () => {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.5 });
    const old = new Date(NOW.getTime() - 5 * ACTIVATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    entry.lastReinforcedAt = old.toISOString();

    const { deps, apply } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, null, TX, deps);
    expect(result).toMatchObject({ ok: true, applied: true, tierChanged: true });
    expect(apply).toHaveBeenCalledWith(expect.objectContaining({ nextMaturityState: "decayed" }), TX);
  });

  it("anti audit-spam: a sub-delta decay with no tier change is a no-op", async () => {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.8 });
    // Tiny elapsed time → Δactivation below the delta, tier unchanged.
    const recent = new Date(NOW.getTime() - 60 * 1000); // 1 minute
    entry.lastReinforcedAt = recent.toISOString();

    const { deps, apply, audit } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, null, TX, deps);
    expect(result).toEqual({ ok: true, applied: false, reason: "below_delta" });
    expect(apply).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
    // Sanity: the same-day re-sweep delta really is below the threshold.
    expect(DECAY_AUDIT_MIN_DELTA).toBeGreaterThan(0);
  });

  it("'none' policy is a defensive no-op", async () => {
    const entry = makeEntry({ decayPolicy: "none", activationStrength: 1.0 });
    const { deps, apply } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, null, TX, deps);
    expect(result.applied).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  // Regression: the verification sweep-idempotency test caught COMPOUNDING decay
  // (a re-run re-applied the FULL since-reinforcement factor to the already-
  // decayed value). The incremental anchor (`last_decayed_at`) must make an
  // immediate re-run a no-op for ANY entry age.
  it("INCREMENTAL anchor: an immediate re-run after an applied decay is a no-op (no compounding)", async () => {
    const reinforced = new Date(NOW.getTime() - ACTIVATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    const justDecayed = new Date(NOW.getTime() - 60 * 1000); // applied 1 minute ago
    const entry = makeEntry({
      maturityState: "established",
      activationStrength: 0.4, // already eroded by the prior applied step
      lastReinforcedAt: reinforced.toISOString(),
      lastDecayedAt: justDecayed.toISOString(),
    });

    const { deps, apply, audit } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, null, TX, deps);

    // Without the anchor this would compound: 0.4 × 0.5^(30/30) = 0.2 (a write).
    expect(result).toEqual({ ok: true, applied: false, reason: "below_delta" });
    expect(apply).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("INCREMENTAL anchor: an applied decay stamps last_decayed_at; the next interval erodes only its quantum", async () => {
    // Reinforced 40 days ago, last applied decay 30 days ago → only the 30-day
    // quantum since the ANCHOR erodes now (0.4 → 0.2), not the 40-day total.
    const reinforced = new Date(NOW.getTime() - 40 * 24 * 60 * 60 * 1000);
    const lastDecay = new Date(NOW.getTime() - ACTIVATION_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000);
    const entry = makeEntry({
      maturityState: "established",
      activationStrength: 0.4,
      lastReinforcedAt: reinforced.toISOString(),
      lastDecayedAt: lastDecay.toISOString(),
    });

    const { deps, apply } = makeDeps(entry);
    const result = await decayEntry(entry, NOW, null, TX, deps);

    expect(result).toMatchObject({ ok: true, applied: true });
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBeCloseTo(0.2, 6);
    }
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({ bumpLastDecayedAt: true, bumpLastReinforcedAt: false }),
      TX,
    );
  });
});

// ── decayEntry — S6b regime modulation + reactivation ─────────────

describe("decayEntry — regime-modulated decay (S6b)", () => {
  const NOW = new Date("2026-01-31T00:00:00Z");

  /** Entry last reinforced exactly `days` before NOW. */
  function agedEntry(days: number, overrides: Partial<MaturityEntryRow> = {}): MaturityEntryRow {
    const entry = makeEntry({ maturityState: "established", activationStrength: 0.8, ...overrides });
    entry.lastReinforcedAt = new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    return entry;
  }

  it("mismatch erodes on the SHORT half-life (15d): one mismatch half-life halves activation", async () => {
    const mismatchHalfLife = ACTIVATION_HALF_LIFE_DAYS * REGIME_MISMATCH_HALF_LIFE_FACTOR;
    const entry = agedEntry(mismatchHalfLife, { regimeTags: ["bear"] }); // regime is bull → mismatch
    const { deps, audit } = makeDeps(entry);

    const result = await decayEntry(entry, NOW, makeRegime({ confidence: "medium" }), TX, deps);
    expect(result).toMatchObject({ ok: true, applied: true });
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBeCloseTo(0.4, 6); // 0.8 × 0.5^1
    }
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "decayed",
        reasonCode: "regime_decay",
        triggerRefs: { regimeSnapshotId: 99 },
      }),
      TX,
    );
  });

  it("match erodes on the LONG half-life (60d): one base half-life only quarters the exponent", async () => {
    const entry = agedEntry(ACTIVATION_HALF_LIFE_DAYS, { regimeTags: ["bull"] }); // regime bull → match
    const { deps, audit } = makeDeps(entry);

    const result = await decayEntry(entry, NOW, makeRegime({ confidence: "medium" }), TX, deps);
    expect(result).toMatchObject({ ok: true, applied: true });
    if (result.ok && result.applied) {
      // 30 days over a 60d half-life → 0.8 × 0.5^0.5 ≈ 0.5657 (slower than 0.4).
      expect(result.activationAfter).toBeCloseTo(0.8 * Math.pow(0.5, 1 / REGIME_MATCH_HALF_LIFE_FACTOR), 6);
      expect(result.activationAfter).toBeGreaterThan(0.4);
    }
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "regime_decay", triggerRefs: { regimeSnapshotId: 99 } }),
      TX,
    );
  });

  it("neutral (no tags) keeps the base 30d half-life and the S6a time_decay audit shape", async () => {
    const entry = agedEntry(ACTIVATION_HALF_LIFE_DAYS, { regimeTags: [] });
    const { deps, audit } = makeDeps(entry);

    const result = await decayEntry(entry, NOW, makeRegime(), TX, deps);
    expect(result).toMatchObject({ ok: true, applied: true });
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBeCloseTo(0.4, 6);
    }
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "time_decay", triggerRefs: {} }),
      TX,
    );
  });

  it("regime === null is bit-for-bit S6a (base half-life, time_decay, empty refs) even with tags", async () => {
    const entry = agedEntry(ACTIVATION_HALF_LIFE_DAYS, { regimeTags: ["bull"] });
    const { deps, audit } = makeDeps(entry);

    const result = await decayEntry(entry, NOW, null, TX, deps);
    expect(result).toMatchObject({ ok: true, applied: true });
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBeCloseTo(0.4, 6);
    }
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ event: "decayed", reasonCode: "time_decay", triggerRefs: {} }),
      TX,
    );
  });

  it("a 'time'-policy entry ignores the regime entirely (neutral path)", async () => {
    const entry = agedEntry(ACTIVATION_HALF_LIFE_DAYS, { decayPolicy: "time", regimeTags: ["bear"] });
    const { deps, audit } = makeDeps(entry);

    const result = await decayEntry(entry, NOW, makeRegime(), TX, deps);
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBeCloseTo(0.4, 6); // base half-life, no mismatch speed-up
    }
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ reasonCode: "time_decay" }), TX);
  });

  it("the DECAY_FLOOR holds under mismatch decay (never deletes, never below floor)", async () => {
    const entry = agedEntry(1000 * ACTIVATION_HALF_LIFE_DAYS, { regimeTags: ["bear"] });
    const { deps } = makeDeps(entry);

    const result = await decayEntry(entry, NOW, makeRegime(), TX, deps);
    expect(result.ok).toBe(true);
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBe(DECAY_FLOOR);
      expect(result.activationAfter).toBeGreaterThan(0);
    }
  });

  it("REACTIVATES decayed+match+high to established (before the below_delta skip), with the full audit row", async () => {
    // A decayed entry at the floor whose day-over-day delta is ~0 — the skip
    // branch would swallow this if reactivation were ordered after it.
    const entry = agedEntry(0.04, {
      maturityState: "decayed",
      activationStrength: DECAY_FLOOR,
      regimeTags: ["bull"],
    });
    const { deps, apply, audit } = makeDeps(entry);

    const result = await decayEntry(entry, NOW, makeRegime({ confidence: "high" }), TX, deps);
    expect(result).toMatchObject({ ok: true, applied: true, tierChanged: true });
    if (result.ok && result.applied) {
      expect(result.activationAfter).toBe(REACTIVATION_ACTIVATION);
    }
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        nextMaturityState: "established",
        nextActivation: REACTIVATION_ACTIVATION,
        bumpLastReinforcedAt: true, // reactivation restarts the decay clock
      }),
      TX,
    );
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "reactivated",
        fromState: "decayed",
        toState: "established",
        reasonCode: "regime_decay",
        triggerRefs: { regimeSnapshotId: 99 },
        decidedBy: "system",
      }),
      TX,
    );
  });

  it("does NOT reactivate on medium confidence (decayed+match stays in normal decay)", async () => {
    const entry = agedEntry(0.04, {
      maturityState: "decayed",
      activationStrength: DECAY_FLOOR,
      regimeTags: ["bull"],
    });
    const { deps, apply, audit } = makeDeps(entry);

    const result = await decayEntry(entry, NOW, makeRegime({ confidence: "medium" }), TX, deps);
    // Normal decay path: at the floor with ~0 delta → below_delta no-op.
    expect(result).toEqual({ ok: true, applied: false, reason: "below_delta" });
    expect(apply).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });

  it("does NOT reactivate a mismatching or neutral decayed entry under a high regime", async () => {
    for (const tags of [["bear"], []]) {
      const entry = agedEntry(0.04, {
        maturityState: "decayed",
        activationStrength: DECAY_FLOOR,
        regimeTags: tags,
      });
      const { deps, audit } = makeDeps(entry);
      await decayEntry(entry, NOW, makeRegime({ confidence: "high" }), TX, deps);
      expect(audit).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: "reactivated" }),
        TX,
      );
    }
  });

  it("does NOT reactivate a non-decayed matching entry (only decayed entries resurrect)", async () => {
    const entry = agedEntry(ACTIVATION_HALF_LIFE_DAYS, {
      maturityState: "established",
      regimeTags: ["bull"],
    });
    const { deps, audit } = makeDeps(entry);
    await decayEntry(entry, NOW, makeRegime({ confidence: "high" }), TX, deps);
    expect(audit).not.toHaveBeenCalledWith(expect.objectContaining({ event: "reactivated" }), TX);
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ event: "decayed" }), TX);
  });
});
