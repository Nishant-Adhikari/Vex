/**
 * Judge-decision benchmark — INDEPENDENT ORACLE cluster B (ids M046–M090).
 *
 * Pre-registered EXPECTED-correct judge decisions for the cluster-B id range,
 * reasoned from PRODUCT INTENT and the AGENT-FACING TEXT ALONE (kind + title +
 * summary + contentMd + importance + confidence + anchor shape). This module
 * imports only the prediction TYPE from the oracle stub; the verdict / reason /
 * tier vocabulary it relies on is the stub's own LOCAL re-typed unions (zero
 * policy import, zero decision-logic import). The corpus author's intent,
 * predecessor text, and `stratum` runner-hint were NOT used to pick a verdict.
 *
 * Each row is authored as the verdict a WELL-CALIBRATED judge SHOULD reach:
 *  - clean recurrence-met generalizations → promote (moderate ceiling);
 *  - over-abstraction / regime-blind "always" rules → reject (insufficient ev.);
 *  - honest transient single-session observations → retain (low durability);
 *  - now-resolved market snapshots with no forward value → expire (expired_ttl);
 *  - numeric revisions of an active rule → supersede;
 *  - SEMANTIC mechanism changes (same thesis, different mechanism, no number/date
 *    delta) → ALSO supersede as the CORRECT behavior, but flagged knownGap:F7
 *    because the current pipeline likely PROMOTES (no deterministic conflict key);
 *  - high-confidence n=1 / no-realized-outcome assertions → reject;
 *  - outcome-anchored "it worked so the decision was right" lessons → reject.
 */

import type { JudgeOraclePrediction } from "./_judge-oracle.js";

// ── Local band helper (readability; mirrors the stub, no import of its helper) ──
const band = (lo: number, hi: number): { readonly lo: number; readonly hi: number } => ({ lo, hi });

/**
 * Oracle predictions for ids M046–M090. One row per id, append-order ascending.
 */
export const ORACLE_B: Record<string, JudgeOraclePrediction> = {
  // ── M046–M048: clean pumpfun entry patterns, recurrence-met (2 anchors). ────
  // Concrete, process-grounded, repeatable gates observed across launches. A
  // well-calibrated judge promotes these durable strategy rules at a grounded
  // (moderate) tier — recurrence is met, but there is no closed-trade realized
  // PnL or user affirmation that would justify a strong ceiling.
  M046: {
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: band(3, 5),
      durability: band(3, 5),
      novelty: band(2, 4),
      generalizability: band(3, 5),
      processNotOutcome: band(3, 5),
    },
    rationale:
      "Two-check entry gate (renounced mint AND burned LP) shown across launches to filter most rug outcomes — a grounded, process-first, generalizable rule. Promote at a moderate (recurrence-met) tier.",
  },

  M047: {
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: band(3, 5),
      durability: band(3, 5),
      novelty: band(2, 4),
      generalizability: band(3, 5),
      processNotOutcome: band(3, 5),
    },
    rationale:
      "Buy the first higher-low pullback after graduation rather than chasing the migration candle — a repeatable, process-based entry observed across graduated launches. Promote, moderate tier.",
  },

  M048: {
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: band(3, 5),
      durability: band(3, 5),
      novelty: band(2, 4),
      generalizability: band(2, 4),
      processNotOutcome: band(3, 5),
    },
    rationale:
      "Veto entry on heavy top-ten wallet concentration; the rule is explicitly narrowed to fresh launches and grounded in repeated front-run dumps. Promote at a moderate tier; the self-scoping slightly bounds generalizability.",
  },

  // ── M049–M050: trap pumpfun patterns — over-abstraction / regime-blind. ─────
  // M049 inflates a couple of post-graduation pumps into an 'always pumps'
  // guarantee at conf 0.90; the certainty is unjustified by the evidence. M050
  // restates a bull-only euphoric habit as a permanent unconditional rule, which
  // is a losing instruction in the current bear tape. Both must be rejected as
  // insufficiently grounded for the universal claim made — the high stated
  // confidence is overridden, not honored.
  M049: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "'Every graduation always pumps' is an over-abstraction to a guarantee from a couple of cases; many graduate and fade. The asserted certainty is ungrounded — reject, do not honor the inflated confidence.",
  },

  M050: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 2),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "Regime-blind: full-size immediate entry only worked in a frothy bull and is stated as an unconditional always-rule — a losing instruction in the current bear regime. Reject; the lesson is durable only as an anti-pattern.",
  },

  // ── M051–M052: gray single-session observations (1 anchor). ─────────────────
  // Honest, correctly-hedged transient notes that the author themselves flags as
  // NOT yet a durable rule. The calibrated move is to RETAIN them as recallable
  // context — neither promote to a rule (durability/generalizability are low on a
  // single window) nor reject (they are truthful, useful, non-harmful context).
  M051: {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "A single-session WIF/BONK correlation note, self-flagged as transient and not rule-worthy. Truthful, useful context but not durable — retain as recallable context rather than promote.",
  },

  M052: {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "One weekend of thinner POPCAT pool depth, explicitly not enough to promote a weekday/weekend liquidity rule. Honest low-durability observation — retain, do not promote.",
  },

  // ── M053–M054: trap market notes — now-resolved transient state (1 anchor). ─
  // Both record a momentary market condition that has ALREADY reversed by the
  // time of writing (SOL fear spike fully recovered; Drift funding flipped back
  // positive). There is no forward value: acting on the recorded state now is
  // backward-looking. The calibrated decision is to EXPIRE — the content's useful
  // life is over (expired_ttl), distinct from a grounding failure.
  M053: {
    expectedVerdict: "expire",
    expectedTierCeiling: "none",
    expectedRejectReason: "expired_ttl",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 1),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A now-resolved intraday SOL fear spike that has fully retraced — the moment has passed and carries no forward value. Expire on expired-TTL grounds; durability is effectively zero.",
  },

  M054: {
    expectedVerdict: "expire",
    expectedTierCeiling: "none",
    expectedRejectReason: "expired_ttl",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 1),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "Stale funding snapshot: deeply-negative Drift funding already flipped positive. Acting on the recorded negative funding now is backward-looking — expire on expired-TTL; no durable forward value.",
  },

  // ── M055–M078: revisions of an ACTIVE rule → supersede the predecessor. ─────
  // The correct judge retires the stale rule and installs the revision. Tier
  // ceiling is moderate: a durable, grounded rule revision with realized rationale
  // but no closed-trade PnL / user affirmation. Target selection is SOFT.
  //
  // NUMERIC / DATE revisions (deterministic conflict key fires) — M055, M056,
  // M058, M059, M060, M061, M063, M064, M065, M067, M068, M069, M070, M072,
  // M073, M074, M075, M077, M078.
  M055: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric tightening of the per-trade cap (5%→2% after a second weekly drawdown) with a realized rationale (clustered drawdowns chewed the book). Supersede the stale 5% rule.",
  },

  M056: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric widening of the SOL momentum stop (8%→12%) because the tight stop was noise-clipped before the move resumed. Supersede the stale stop.",
  },

  M057: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    knownGap: {
      code: "F7",
      note: "Semantic mechanism change (price stop → session time-stop), SAME goal, no number/date delta — the deterministic conflict key does not fire, so the pipeline likely PROMOTES a peer instead of superseding. Expectation is the CORRECT supersede; flagged.",
    },
    rationale:
      "Replaces the structural price stop with a session time-stop to tolerate the WIF retest — same intent, new mechanism. Correct behavior is to retire the price-stop rule (supersede), though F7 means the pipeline may promote instead.",
  },

  M058: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric leverage cut (5x→3x on Drift majors) after a wick nearly liquidated a correct call. Supersede the stale 5x rule.",
  },

  M059: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Date revision of the add-to-strength retirement cutover (2026-03-15 → 2026-04-01) as the tape turned to a range. A direct revision of an active rule — supersede.",
  },

  M060: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric raise of the memecoin volume floor (250k→1M) because exits slipped on thin books. Supersede the stale 250k rule.",
  },

  M061: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric move of the first BONK take-profit rung (40%→25%) because the unbanked tranche round-tripped. Supersede the stale 40% rung; banking realized profit is process-sound.",
  },

  M062: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(3, 5),
      processNotOutcome: band(2, 4),
    },
    knownGap: {
      code: "F7",
      note: "Semantic mechanism change (flat notional → slippage-budget sizing), SAME intent of not overtrading thin liquidity, no number delta the conflict key can read — pipeline likely PROMOTES instead of superseding. Expectation is the correct supersede; flagged.",
    },
    rationale:
      "Replaces fixed-notional sizing with a round-trip-slippage budget against live pool depth — same intent, new mechanism, and a more general rule. Correct behavior is supersede; F7 risk noted.",
  },

  M063: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric raise of the Drift funding-exit threshold (0.05%→0.1% per 8h) because the tighter line cut out trends that paid the carry. Supersede the stale threshold.",
  },

  M064: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric relaxation of the mint-authority revocation window (24h→72h) that keeps rug protection while not excluding slow-but-safe launches. A reasoned revision of an active gate — supersede.",
  },

  M065: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric cut of the concurrent-position cap (6→4) in the bear because correlated names bled as one bet. Regime-scoped and grounded — supersede the stale cap.",
  },

  M066: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(3, 5),
      processNotOutcome: band(2, 4),
    },
    knownGap: {
      code: "F7",
      note: "Semantic mechanism change (volume-spike confirmation → structural retest), SAME goal of only trading real breakouts, no number delta — conflict key will not fire, pipeline likely PROMOTES. Expectation is the correct supersede; flagged.",
    },
    rationale:
      "Replaces volume-spike confirmation with a holding-retest requirement — same goal, new mechanism, and a more robust entry filter. Correct behavior is supersede; F7 risk noted.",
  },

  M067: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric cut of the JUP staking allocation cap (30%→15%) to keep dry powder liquid given the unbond cooldown. Reasoned revision — supersede the stale cap.",
  },

  M068: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric tightening of the POPCAT trailing stop (15%→8%) because the wide trail surrendered open gains on fast reversals. Supersede the stale trail.",
  },

  M069: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric raise of the holder floor (500→2000) to better screen for real distribution. A grounded revision of an active entry gate — supersede.",
  },

  M070: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric tightening of the daily circuit-breaker (10%→6% book drawdown) because the deeper hole compounded bad trades. Supersede the stale breaker level.",
  },

  M071: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    knownGap: {
      code: "F7",
      note: "Semantic mechanism change (withdraw LP on depeg → delta-hedge with a perp short), SAME goal of surviving a depeg without a directional hit, no number delta — conflict key will not fire, pipeline likely PROMOTES. Expectation is the correct supersede; flagged.",
    },
    rationale:
      "Replaces reflexive LP withdrawal (which crystallizes impermanent loss at the panic low) with a perp delta-hedge until the peg resolves — same goal, new mechanism. Correct behavior is supersede; F7 risk noted.",
  },

  M072: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric tightening of Jupiter slippage tolerance (1%→0.5% on liquid names) to cut sandwich give-up. Supersede the stale tolerance.",
  },

  M073: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric extension of the post-stop-out re-entry cooldown (1h→4h) to break the tilt-driven chase. Supersede the stale cooldown; the rule is process-sound (anti-tilt).",
  },

  M074: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric cut of the Drift perp OI footprint cap (2%→0.5%) because the larger footprint walked the mark on exit. Supersede the stale cap.",
  },

  M075: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric raise of the minimum reward-to-risk (1.5:1 → 2.5:1) in the bear to restore positive expectancy at a lower hit-rate. Regime-scoped, grounded revision — supersede.",
  },

  M076: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(3, 5),
      processNotOutcome: band(2, 4),
    },
    knownGap: {
      code: "F7",
      note: "Semantic mechanism change (blanket-skip verticals → enter on first holding higher-low pullback), SAME goal of not buying the parabola top, no number delta — conflict key will not fire, pipeline likely PROMOTES. Expectation is the correct supersede; flagged.",
    },
    rationale:
      "Replaces a reflexive skip-all-verticals rule with a defined-risk first-pullback entry — same goal, new mechanism, and a more capable rule. Correct behavior is supersede; F7 risk noted.",
  },

  M077: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric tightening of the stale-quote guard (5s→2s) because a 5s quote was off the live market in fast tape. Supersede the stale freshness window.",
  },

  M078: {
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(3, 5),
      novelty: band(3, 5),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Numeric raise of the scale-out fraction (25%→33% per rung) to de-risk faster on abrupt reversals. Supersede the stale scale-out fraction.",
  },

  // ── M079–M084: trap — high-confidence assertion off n=1 / no realized exit. ─
  // Each frames a single unproven observation as 'near-certain' / 'almost always'
  // / 'reliable', with the position outcome unresolved or unstated. The grounding
  // does not support the asserted confidence; the calibrated judge rejects rather
  // than honoring the conviction. Insufficient evidence is the reason.
  M079: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "'Front-running the Raydium migration is a near-certain edge' asserted at conf 0.96 from one observation with no realized exit. Conviction is claimed, not demonstrated — reject as insufficiently grounded.",
  },

  M080: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "'Holding through the first liquidation cascade is almost always safe' at conf 0.94 with no realized recovery — a single unresolved tense moment. Dangerous over-confidence — reject as ungrounded.",
  },

  M081: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "'First green 5-minute candle is a high-probability BONK setup' asserted from one entry with the outcome unstated. Confidence without a track record — reject.",
  },

  M082: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "'POPCAT reclaims its prior high almost every time after a sharp wick' at conf 0.95 from one wick with no realized result. Grounding does not support the near-certainty — reject.",
  },

  M083: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "'Round-number Jupiter limit orders fill reliably and beat market entries' from a single fill, no comparison, no realized edge. Unearned confidence — reject as insufficiently grounded.",
  },

  M084: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "'5x on WIF never gets liquidated' at conf 0.93 from one open, untested position — no liquidation stress survived. The safety claim is asserted, not grounded — reject (and it is risk-dangerous).",
  },

  // ── M085–M090: trap — outcome-anchored 'it worked so it was right' lessons. ─
  // Each justifies a decision (or builds a rule) purely from the realized result,
  // with NO pre-decision signal, setup, or repeatable trigger. This is the
  // process-not-outcome failure the judge must catch; several (M088, M090) reward
  // a process violation or generalize a lucky result into actively-harmful advice.
  // Reject for all — the grounding is the outcome, not a defensible rationale.
  M085: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 2),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 1),
    },
    rationale:
      "'Buying WIF was correct because it went up' — validated purely by the realized outcome, no pre-decision signal or repeatable process. Pure outcome-anchoring — reject.",
  },

  M086: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 2),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 1),
    },
    rationale:
      "'BONK kept rising after exit, so always hold longer' — backward-looking regret reasoning from where price ended, not from a signal at the decision point. Reject as outcome-anchored.",
  },

  M087: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 2),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 1),
    },
    rationale:
      "'The POPCAT trade proves chasing green candles works' from one favorable result, no edge or base rate. Single-instance outcome generalization — reject.",
  },

  M088: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 2),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 1),
    },
    rationale:
      "'Ignoring the stop on SOL paid off because it bounced' rewards a process violation purely on a lucky outcome and teaches the opposite of a sound rule. Reject — actively harmful.",
  },

  M089: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 2),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 1),
    },
    rationale:
      "'Aping the JUP listing was smart because it doubled' — result-anchored with no pre-move rationale described. Reject as outcome-justified, not process-grounded.",
  },

  M090: {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 2),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 1),
    },
    rationale:
      "'Skipping research worked out, so research is optional' generalizes a lucky outcome into an actively-harmful process rule. The grounding is the result, not a defensible pre-trade rationale — reject.",
  },
};
