/**
 * BROKEN-DECAY canary (S1 of the time-simulated memory eval).
 *
 * This is the smallest, highest-value slice that proves the simulated-clock
 * harness can detect WRONGNESS (not merely drift). It drives the REAL decay
 * engine (`runDecaySweep` → `decayEntry` → `applyMaturityTransition`) over a
 * simulated 90-day span and HARD-asserts that one decayable lesson actually
 * reaches `maturity_state='decayed'` with activation near the floor.
 *
 * It reds if DECAY_FLOOR >= DECAY_TO_DECAYED_THRESHOLD (a lesson that can never
 * decay — the review's "BROKEN DECAY" escape), and the oracle numbers here are
 * INDEPENDENT hardcoded literals, NOT imports of the policy constants, per the
 * adversarial review: the canary is an oracle independent of the code it checks.
 *
 * NO judge, NO OpenRouter — pure decay math + real Gemma embeddings. It runs
 * under the standard integration config (testcontainers pg + Gemma probe) and
 * must NOT gate on OPENROUTER_API_KEY.
 *
 * Time model: per the wall-projection invariant in `_sim-clock.ts`. At each
 * checkpoint we capture ONE `wallNow`, project the entry's anchors onto it, and
 * feed that SAME `wallNow` to the sweep as its injected `now`. The compounding
 * fix (an applied decay stamps `last_decayed_at = NOW()`, crud.ts:272) is
 * handled by re-backdating `last_decayed_at` to the PRIOR sim day before each
 * subsequent sweep, so the next sweep sees the intended Δt rather than Δt ≈ 0.
 */

import { describe, it, expect, beforeEach } from "vitest";

import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import { runDecaySweep } from "@vex-agent/engine/memory-manager/decay-sweep.js";
import { resetDb } from "../setup/fixtures.js";
import { seedPromotedLessonDirect } from "./_eval-fixtures.js";
import { backdateKnowledgeEntry, simRegimeDeps } from "./_sim-clock.js";

// ── INDEPENDENT oracle literals (NOT imported from maturity-policy) ──────────
// These mirror the SPEC, hand-typed so a mis-tuned policy constant cannot make
// the canary internally consistent with a broken implementation.
//   - half-life 30 sim-days, activation seed 1.0
//   - closed form after 90 days: 1.0 * 0.5^(90/30) = 0.5^3 = 0.125
//   - DECAY_TO_DECAYED_THRESHOLD = 0.2  → 0.125 <= 0.2, so it must tier to 'decayed'
//   - DECAY_FLOOR = 0.03                → 0.125 >= 0.03, so it must NOT hit the floor
const DECAYED_THRESHOLD_LITERAL = 0.2;
const FLOOR_LITERAL = 0.03;
const EXPECTED_ACTIVATION_AT_90D = 0.125; // 1.0 * 0.5^(90/30)

// Whole sim-days only, well past the 0.2 threshold boundary — never an exact
// day-fraction that sits ON the threshold.
const SWEEP_DAYS = [15, 30, 45, 60, 75, 90] as const;
const PROMOTED_AT_SIM_DAY = 0;

describe("eval: sim-clock BROKEN-DECAY canary (no judge)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("a time-decay lesson reaches maturity_state='decayed' near the floor after ~90 sim-days", async () => {
    // ── 1. Seed ONE decayable lesson at full activation ──────────────────
    // seedPromotedLessonDirect defaults decay_policy='none' and leaves
    // first_promoted_at/last_reinforced_at NULL, so we MUST set a DECAYABLE
    // policy explicitly and backdate the decay anchors (else daysSince=0).
    const { id } = await seedPromotedLessonDirect({
      kind: "trade_lesson",
      title: "Momentum scale-ins decayed without fresh confirmation",
      summary:
        "A lesson that was promoted once and never reinforced again; pure time decay should erode its activation over the simulated quarter.",
      source: "observed",
      maturityState: "established",
      activationStrength: 1.0,
      decayPolicy: "time", // pure time decay → neutral 30d half-life (no regime)
    });

    // ── 2. Advance the sim clock with intermediate sweeps ────────────────
    // Each checkpoint: capture ONE fresh wallNow, re-project the day-0 anchors
    // onto it, re-backdate last_decayed_at to the PRIOR sim instant (the
    // compounding fix), then sweep with that SAME wallNow.
    let priorSweepDay: number | null = null;
    for (const simNowDay of SWEEP_DAYS) {
      const wallNow = new Date(); // ONE capture per checkpoint (load-bearing)

      // Anchor: laterOf(lastReinforcedAt ?? firstPromotedAt, lastDecayedAt).
      // Keep the reinforcement-side anchor pinned at sim day 0, and (after the
      // first applied decay) place last_decayed_at at the PRIOR sweep day so
      // the next sweep's Δt = simNowDay - priorSweepDay (~15d), not ~0.
      await backdateKnowledgeEntry(
        id,
        {
          firstPromotedAt: PROMOTED_AT_SIM_DAY,
          lastReinforcedAt: PROMOTED_AT_SIM_DAY,
          ...(priorSweepDay === null ? {} : { lastDecayedAt: priorSweepDay }),
        },
        simNowDay,
        wallNow,
      );

      await runDecaySweep(wallNow, simRegimeDeps(wallNow));
      priorSweepDay = simNowDay;
    }

    // ── 3. HARD ASSERTIONS (independent literals, not policy imports) ─────
    const entry = await knowledgeRepo.getById(id);
    // The maturity FSM NEVER deletes a row — the entry must still exist.
    expect(entry).not.toBeNull();
    if (!entry) throw new Error("unreachable: entry asserted non-null above");

    // eslint-disable-next-line no-console
    console.log(
      `[canary] final maturity_state=${entry.maturityState} activation=${entry.activationStrength} status=${entry.status}`,
    );

    // Reached the decayed tier (catches DECAY_FLOOR >= DECAY_TO_DECAYED_THRESHOLD).
    expect(entry.maturityState).toBe("decayed");
    // Activation crossed the decayed threshold but did NOT collapse to the floor.
    expect(entry.activationStrength).toBeLessThanOrEqual(DECAYED_THRESHOLD_LITERAL);
    expect(entry.activationStrength).toBeGreaterThanOrEqual(FLOOR_LITERAL);
    // Closed-form sanity: ~0.125 after 90d (tolerance for per-step quantization
    // of the intermediate sweeps; far from both bounds either way).
    expect(entry.activationStrength).toBeGreaterThan(0.05);
    expect(entry.activationStrength).toBeLessThan(0.2);
    expect(Math.abs(entry.activationStrength - EXPECTED_ACTIVATION_AT_90D)).toBeLessThan(0.05);
    // Decay is influence erosion, never lineage change — the row stays active.
    expect(entry.status).toBe("active");
  });

  // ── NEGATIVE CONTROL — proves the canary has teeth ─────────────────────
  // A decay_policy='none' lesson is EXCLUDED by the sweep query
  // (listDecayableEntries filters `decay_policy <> 'none'`), so the same 90-day
  // advance must leave it untouched. If this entry decayed, the green of the
  // positive canary would be meaningless.
  it("negative control: a decay_policy='none' lesson does NOT decay over the same span", async () => {
    const { id } = await seedPromotedLessonDirect({
      kind: "trade_lesson",
      title: "Pinned-style evergreen lesson that must never decay",
      summary:
        "A non-decaying lesson used as the negative control; the sweep must skip it entirely over the simulated quarter.",
      source: "observed",
      maturityState: "established",
      activationStrength: 1.0,
      decayPolicy: "none", // the sweep filters this OUT
    });

    let priorSweepDay: number | null = null;
    for (const simNowDay of SWEEP_DAYS) {
      const wallNow = new Date();
      await backdateKnowledgeEntry(
        id,
        {
          firstPromotedAt: PROMOTED_AT_SIM_DAY,
          lastReinforcedAt: PROMOTED_AT_SIM_DAY,
          ...(priorSweepDay === null ? {} : { lastDecayedAt: priorSweepDay }),
        },
        simNowDay,
        wallNow,
      );
      await runDecaySweep(wallNow, simRegimeDeps(wallNow));
      priorSweepDay = simNowDay;
    }

    const entry = await knowledgeRepo.getById(id);
    expect(entry).not.toBeNull();
    if (!entry) throw new Error("unreachable: entry asserted non-null above");
    // Untouched: still established, still at full activation.
    expect(entry.maturityState).toBe("established");
    expect(entry.activationStrength).toBe(1.0);
    expect(entry.status).toBe("active");
  });
});
