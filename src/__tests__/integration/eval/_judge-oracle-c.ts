/**
 * Judge-decision benchmark — INDEPENDENT ORACLE cluster C (ids M091–M134).
 *
 * Authored ONLY from the agent-facing text accessor (`judgeItemFacing`) — kind,
 * title, summary, contentMd, importance, confidence, anchor shape. No corpus
 * cluster file was opened; no `stratum` field was used as a verdict hint; no
 * judge prompt/schema was read. Each row records what a WELL-CALIBRATED memory
 * judge SHOULD decide from the lesson's MERIT alone (grounding, novelty,
 * durability, generalizability, process-not-outcome, regime-fit, truthfulness).
 *
 * Rubric expectations are SOFT inclusive bands `[lo, hi]` (the live LLM jitters).
 * `expectedTierCeiling` is authored from the EVIDENCE STORY (n, realized outcome,
 * user affirmation), never from a clamp constant.
 *
 * Pure TEST-ONLY data. Imports the prediction TYPE from the oracle stub; the
 * verdict / reject-reason vocabulary is otherwise re-typed locally in the stub
 * (zero policy import) and reused here. This file adds no decision logic.
 */

import type { JudgeOraclePrediction } from "./_judge-oracle.js";

// ── Band helper (readability; mirrors the stub's private helper) ──
const band = (lo: number, hi: number): { readonly lo: number; readonly hi: number } => ({ lo, hi });

/**
 * Cluster C predictions, STRICT id-ascending order M091 → M134 (44 rows). The
 * prediction shape carries no id; the row order is the contract. Each row is
 * id-tagged in a leading comment for human review only.
 */
export const ORACLE_C: JudgeOraclePrediction[] = [
  // ──────────────────────────────────────────────────────────────────────────
  //  M091–M096 — COSMETIC NEAR-DUPLICATES (only a rounded number nudged).
  //  Each restates an existing note/rule with no new mechanism, data, or
  //  rationale. A justified numeric REVISION would supersede; a cosmetic
  //  restatement is a DUPLICATE. Novelty floored, durability low. Reject.
  // ──────────────────────────────────────────────────────────────────────────

  // M091 market_note — "first ~5 hours carry the volume"; identical observation,
  // only the rounded hour figure differs. No new mechanism/evidence → duplicate.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "duplicate",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 3),
      novelty: band(1, 2),
      generalizability: band(2, 4),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "Cosmetic restatement of an existing volume-timing note; only the rounded hour figure changed. No fresh mechanism or evidence — reject as duplicate.",
  },

  // M092 market_note — BONK lead-lag restated with a slightly different rounded
  // hour figure and nothing else. No fresh data or reasoning → duplicate.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "duplicate",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 3),
      novelty: band(1, 2),
      generalizability: band(2, 4),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "Restates the existing lead-lag note with a nudged hour figure and no new data. A cosmetic dup, not a justified revision — reject as duplicate.",
  },

  // M093 observation — Jupiter WIF routing near-verbatim of an existing
  // observation with a single changed pool count; adds no insight → duplicate.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "duplicate",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 3),
      novelty: band(1, 2),
      generalizability: band(2, 4),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "Near-verbatim of an existing routing observation; only the pool count changed. No new confirmation or insight — reject as duplicate.",
  },

  // M094 protocol_fact — Drift funding cadence restated with a different
  // interval; the number is the only delta. Cosmetic near-dup → duplicate.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "duplicate",
    rubric: {
      grounding: band(1, 3),
      durability: band(2, 4),
      novelty: band(1, 2),
      generalizability: band(2, 4),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "Restates the existing funding-cadence fact with only the interval changed and no source. A cosmetic dup, not a verified revision — reject as duplicate.",
  },

  // M095 risk_rule — existing sizing cap nudged one point with NO rationale for
  // the change. Cosmetic restatement, not a justified revision → duplicate.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "duplicate",
    rubric: {
      grounding: band(1, 3),
      durability: band(2, 4),
      novelty: band(1, 2),
      generalizability: band(2, 4),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "The existing position cap with the number nudged and no rationale. A justified revision would supersede; this only restates — reject as duplicate.",
  },

  // M096 strategy_lesson — identical scale-out strategy with the multiple bumped
  // a hair; no new evidence motivates the change → duplicate.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "duplicate",
    rubric: {
      grounding: band(1, 3),
      durability: band(2, 4),
      novelty: band(1, 2),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Restates the existing scale-out lesson with the multiple nudged and no new evidence motivating the change — reject as duplicate.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  M097–M102 — OVER-ABSTRACTION FROM n=1 (universal rule from one instance).
  //  A single name / single event is stretched to "always / every / forever".
  //  Grounding and generalizability floored; the breadth dwarfs the evidence.
  //  Reject: insufficient_evidence.
  // ──────────────────────────────────────────────────────────────────────────

  // M097 strategy_lesson — one WIF breakout ⇒ buy EVERY Solana token on ANY
  // breakout, always. Abstraction far broader than the evidence.
  {
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
      "Universal 'buy any breakout on any token' from a single WIF win. The claim spans all names/all breakouts on n=1 — reject as insufficient evidence.",
  },

  // M098 risk_rule — one BONK stop helped ⇒ never trade without a 10% stop
  // ANYWHERE. Fixed universal parameter ignoring volatility/venue.
  {
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
      "One helpful BONK stop becomes a fixed 10% stop for every instrument and regime, ignoring volatility/venue dependence — reject as insufficient evidence.",
  },

  // M099 strategy_lesson — one SOL-PERP win ⇒ leverage is ALWAYS correct.
  // Disregards liquidation/funding risk; unconditional from n=1.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 2),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "One leveraged win generalized to 'leverage is always correct', ignoring liquidation/funding on the losing side — reject as insufficient evidence.",
  },

  // M100 trade_lesson — one POPCAT scalp ⇒ scalping ALWAYS beats holding on all
  // Solana names. Blanket rule over every token/timeframe from one instance.
  {
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
      "A single POPCAT scalp becomes 'scalping always beats holding' across all tokens/timeframes — the universal is unsupported by n=1. Reject.",
  },

  // M101 strategy_lesson — one good JUP limit fill ⇒ always use limit orders for
  // everything. Ignores fast markets where a resting limit never fills.
  {
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
      "One favorable limit fill elevated to an unconditional 'limit orders for everything', ignoring fast markets where it never fills — reject as insufficient evidence.",
  },

  // M102 heuristic — one mint-authority rug ⇒ avoid EVERY token with ANY
  // authority forever. Ignores legitimate freeze/update-authority cases.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 3),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A single rug becomes a forever-avoid rule for any token with any authority, ignoring valid freeze/update-authority cases — reject as insufficient evidence.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  M103–M108 — FABRICATED / FALSE protocol_fact (contradicted grounding).
  //  Each states an invented or factually wrong mechanism with a precise figure
  //  lending false authority. Grounding floored (contradicted by reality).
  //  Reject: insufficient_evidence (grounding fails the truthfulness bar).
  // ──────────────────────────────────────────────────────────────────────────

  // M103 protocol_fact — "Raydium charges a flat 1% fee on every pool." False:
  // fees vary by pool type/config. No single flat figure exists.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "False as a universal fee fact — Raydium fees vary by pool type. The precise flat figure is fabricated authority; grounding fails. Reject.",
  },

  // M104 protocol_fact — "Jupiter settles on its own Layer 2." Invented:
  // Jupiter is a Solana-native aggregator routing on-chain pools, no L2.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "Invented mechanism — Jupiter is an on-chain Solana aggregator with no separate L2 settlement. Contradicted grounding; reject as insufficient evidence.",
  },

  // M105 protocol_fact — "Drift funding capped at exactly 0.05%/hr." Fabricated
  // constant; Drift funding is market-driven, not a fixed protocol cap.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "Fabricated constant — Drift funding is a market-driven rate, not a hard 0.05%/hr protocol cap. The exact figure lends false authority. Reject.",
  },

  // M106 protocol_fact — "SPL mint has a maxHolders field." Invented: no such
  // attribute; Solana does not cap holder counts at the protocol level.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "Invented field — the SPL mint account has no maxHolders attribute and Solana does not cap holders. Contradicted grounding; reject.",
  },

  // M107 protocol_fact — "pump.fun burns 50% of supply at Raydium migration."
  // False mechanic; migration moves liquidity, the figure is invented.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "False mechanic — the bonding-curve-to-Raydium migration moves liquidity and does not auto-burn 50% of supply. Invented figure; reject as insufficient evidence.",
  },

  // M108 protocol_fact — "Solana refunds priority fees on failed tx." Untrue: a
  // failed tx still consumes base+priority fees for compute used.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 2),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "Untrue — a failed Solana tx still consumes base and prioritization fees; there is no automatic refund. Contradicted grounding; reject.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  M109–M114 — REGIME-MISMATCHED rules stated as UNIVERSAL.
  //  Each is a bull-trend behavior asserted as a timeless/regime-independent
  //  rule while the explicit context is a confirmed/high-vol BEAR — the regime
  //  context directly CONTRADICTS the rule. Durability and generalizability
  //  floored; the universal framing is false in the stated regime. Reject.
  // ──────────────────────────────────────────────────────────────────────────

  // M109 strategy_lesson — "always buy every dip" stated universal during a
  // confirmed downtrend where dips keep continuing lower. Regime-contradicted.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A buy-the-dip rule that only works in an uptrend, stated as universal during a confirmed bear where dips continue lower. Regime-contradicted — reject.",
  },

  // M110 strategy_lesson — "never take profit, let winners run" stated universal
  // in a bear where rallies fade fast / un-trimmed gains round-trip.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "Let-it-ride is bull behavior; asserted as universal in a downtrend where un-trimmed gains round-trip. Regime-mismatched universal — reject.",
  },

  // M111 risk_rule — "max leverage always optimal" authored amid a high-vol bear
  // with cascading liquidations. The most dangerous possible posture.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "Max leverage thrives only in a smooth uptrend; as a universal rule in a liquidation-heavy bear it is the most dangerous posture. Regime-inverted — reject.",
  },

  // M112 strategy_lesson — "always chase strength, never fade" universal during a
  // bear where rallies have been distribution / sell-the-rip.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "Chasing strength is momentum-bull behavior; in the prevailing bear rallies are sell-the-rip. The universal framing is mismatched to the regime — reject.",
  },

  // M113 risk_rule — "holding always recovers, so stops unnecessary" recorded in
  // a sustained bear making lower lows. Removes the discipline the regime needs.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 2),
    },
    rationale:
      "Drawdowns recovered in the prior bull; generalized to 'stops optional' during a persistent bear it removes the exact discipline the regime demands. Reject.",
  },

  // M114 strategy_lesson — "positive funding ⇒ stay long" universal, authored in
  // a bear where positive funding flagged crowded longs about to be flushed.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "In a bull positive funding tracks demand; in this bear it flagged over-leveraged longs before liquidation cascades. The universal long bias is regime-mismatched — reject.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  M115–M128 — HONEST THIN-SAMPLE observations explicitly "NOT YET PROMOTABLE".
  //  These are grounded, truthful, single- or low-sample notes that the author
  //  flags as worth keeping but not yet a rule (n=1, or n=2 narrow/same-asset/
  //  same-window). The calibrated decision is RETAIN: keep the live note alive
  //  for future confirmation, but do not promote a durable rule on thin
  //  evidence. Not junk → not reject; not durable → not promote. Tier ceiling
  //  none/weak (a single fresh observation at most).
  // ──────────────────────────────────────────────────────────────────────────

  // M115 observation — JUP OI built without a spot move, one session. n=1,
  // explicitly "one sighting proves nothing". Keep to watch. Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(3, 5),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Grounded single-session OI/spot divergence the author explicitly keeps but does not promote. n=1 — retain the live note; do not promote a rule.",
  },

  // M116 market_note — WIF/SOL pool depth thinned post-US-close, one day. n=1,
  // "a single day is not enough to promote a time-of-day rule". Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(3, 5),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "A single-day post-close liquidity observation, honestly flagged as not enough to promote a time-of-day rule. Retain for future confirmation.",
  },

  // M117 trade_outcome — POPCAT exited near flat after failed continuation. One
  // closed trade, tentative read, "does not justify a promoted rule yet". Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(3, 5),
      durability: band(1, 3),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "One near-flat closed trade with a tentative follow-through read; the author says it does not justify a promoted rule yet. Retain the outcome, do not promote.",
  },

  // M118 protocol_fact — Drift SOL-PERP funding APPEARED hourly, inferred from
  // one window, not confirmed vs docs. Explicitly "do not promote unverified".
  // Honest tentativeness → retain (keep to cross-check), not reject (not false).
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(2, 4),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A tentative funding-cadence reading from one window, explicitly unverified against docs and flagged 'do not promote'. Honest uncertainty — retain to cross-check, not promote.",
  },

  // M119 user_preference — user "seemed to lean away" from low-liq memecoins
  // once; soft signal, no firm rule. Promoting an enforced preference over-reads
  // one offhand remark. Retain as a hint.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A single soft user signal, not a standing instruction. Promoting it into an enforced preference would over-read one offhand remark — retain as a hint.",
  },

  // M120 observation — BONK/WIF moved together one risk-off afternoon. n=1,
  // "one co-movement is not a stable correlation". Retain to watch.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(3, 5),
      durability: band(1, 3),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "One afternoon of co-movement is not a stable correlation; cannot promote a basket-hedging rule on n=1. Retain the observation to see if it holds.",
  },

  // M121 strategy_lesson — SOL→JUP early rotation outperformed twice; both
  // early-session, no clear mechanism. "Not yet durable or general." Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Two same-window sightings, no clear causal mechanism — suggestive but not yet durable or general. Retain and keep watching before promoting a rotation rule.",
  },

  // M122 trade_lesson — trimming WIF into strength beat holding twice, same
  // choppy stretch. Small-sample, regime-specific. "Not yet promotable." Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Two trims in the same choppy stretch; the give-back avoided is real but small-sample and regime-specific. Retain — not yet a promotable sizing lesson.",
  },

  // M123 risk_rule — cutting leverage on sharp positive funding avoided two
  // squeezes, both one high-funding window. "Two correlated events ... retain."
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(2, 4),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Two avoided squeezes within one high-funding window — sound intuition but two correlated events do not establish a durable leverage rule. Retain for now.",
  },

  // M124 entry_pattern — fast swing-high reclaim preceded two POPCAT
  // continuations, same asset/week, no failed-reclaim counter-examples. Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(2, 4),
    },
    rationale:
      "Two clean reclaims on the same asset/week with no observed failure cases — encouraging but thin and unconfirmed. Retain; not durable enough to promote.",
  },

  // M125 observation — one mid-size SOL→JUP swap fanned across three pools.
  // n=1, hints size triggers splitting but "one swap is not enough". Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(3, 5),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A single routing observation hinting size triggers multi-pool splitting; one swap cannot promote a size-vs-route rule. Retain to gather more.",
  },

  // M126 market_note — SOL realized vol compressed one quiet day. n=1, "reading
  // one day as a regime signal would over-promote a routine lull." Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(3, 5),
      durability: band(1, 3),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "One quiet day of vol compression; reading it as a regime signal would over-promote a routine lull. Retain the note, do not elevate to a rule.",
  },

  // M127 protocol_fact — one BONK pool seen on a higher-than-default fee tier.
  // Accurate but pool-specific; promoting as a general fee expectation
  // over-generalizes from one pool. A true, narrow, durable pool-specific fact
  // → retain (keep the accurate detail; don't broaden it to a rule).
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(3, 5),
      durability: band(2, 4),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "An accurate but narrow pool-specific fee observation; promoting it as a general fee expectation would over-generalize from one pool. Retain the true narrow detail.",
  },

  // M128 strategy_lesson — waiting for first hourly close avoided JUP whipsaw
  // twice, both early session. Process-flavored but narrow/small-sample. Retain.
  {
    expectedVerdict: "retain",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(1, 3),
      processNotOutcome: band(3, 5),
    },
    rationale:
      "Two avoided whipsaws, both JUP/early-session — plausible and process-flavored but narrow and small-sample. Retain; do not yet promote a timing rule.",
  },

  // ──────────────────────────────────────────────────────────────────────────
  //  M129–M134 — GRAY calibration cases (reasoned each on its own merit).
  // ──────────────────────────────────────────────────────────────────────────

  // M129 observation — one large WIF buy print "marked the exact local bottom",
  // stated confidence 0.9. A single after-the-fact coincidence with UNEARNED
  // high confidence (the text itself says the confidence is not earned). The
  // judge must not let the inflated confidence drive a promote; n=1 coincidence
  // cannot establish "large prints mark bottoms". Reject as insufficient.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(1, 3),
      durability: band(1, 2),
      novelty: band(2, 4),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A single after-the-fact print/bottom coincidence dressed in unearned 0.9 confidence. One coincidence cannot establish the claim; the inflated confidence must be overridden — reject as insufficient evidence.",
  },

  // M130 market_note — "SOL leads the basket by ~15 min": the SAME leads-the-
  // basket thesis as an existing note, now with an added approximate lead time.
  // Same thesis / refined detail, no contradicting number or date — this is the
  // F7 SEMANTIC-SUPERSEDE shape. The CORRECT behavior is to supersede the
  // coarser predecessor with the refined version; the current pipeline likely
  // PROMOTES (treats it as a novel peer) rather than supersedes. Expectation =
  // the correct behavior (supersede), flagged knownGap F7.
  {
    expectedVerdict: "supersede",
    expectedTierCeiling: "weak",
    expectsSupersede: true,
    rubric: {
      grounding: band(2, 4),
      durability: band(2, 4),
      novelty: band(2, 4),
      generalizability: band(2, 4),
      processNotOutcome: band(1, 3),
    },
    knownGap: {
      code: "F7",
      note: "Same leads-the-basket thesis refined with a lead-time detail — a semantic supersede (no number/date contradiction). Target selection is the F7 gap; the judge likely promotes-not-supersedes. SOFT on verdict.",
    },
    rationale:
      "Refines the existing 'SOL leads the basket' note with an approximate lead time — same thesis, more precise. Correct behavior is to supersede the coarser predecessor; flagged F7 because the pipeline likely promotes a peer instead.",
  },

  // M131 trade_lesson — "buying SOL dips kept working, so keep buying every dip
  // going forward", authored exactly as breadth deteriorates and the regime
  // turns down. The past edge was real (n≥2) but the FORWARD universal is
  // regime-fragile — durability across the coming regime is explicitly doubtful.
  // A calibrated judge does not promote a forward 'every dip' rule at a regime
  // flip. Reject (forward durability/regime fit fails); soft vs low-durability
  // retain.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "weak",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 2),
      novelty: band(1, 3),
      generalizability: band(1, 3),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A real up-tape dip-buying edge restated as a forward 'keep buying every dip' rule just as the regime turns down — forward durability is doubtful. The regime-fragile universal should not be promoted; reject (soft vs a low-durability retain).",
  },

  // M132 strategy_lesson — narrow TRUE fact (renounced mint removes one rug
  // vector) stretched into an over-broad "renounced-mint tokens are safe to size
  // into" rule, ignoring liquidity/holders/LP locks. Over-generalization from a
  // narrow truth on n=2. Reject as insufficient evidence for the broad claim.
  {
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: band(2, 4),
      durability: band(1, 3),
      novelty: band(1, 3),
      generalizability: band(1, 2),
      processNotOutcome: band(1, 3),
    },
    rationale:
      "A narrow true fact (renounced mint removes one rug vector) stretched into a broad 'safe to size into' rule that ignores liquidity/holders/LP locks. Over-generalized safety claim — reject as insufficient evidence.",
  },

  // M133 risk_rule — skipping the first 10 minutes of a fresh listing avoided two
  // bad fills, but the two events are >1 week apart with nothing between. The
  // recurrence (n=2) is REAL and the rule is a clean process caution, but the
  // clustering is slow/thin — genuinely borderline. A calibrated judge can
  // promote a process risk rule with met recurrence, at a WEAK tier. Lean
  // promote; soft on durability (a careful judge could retain).
  {
    expectedVerdict: "promote",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(2, 4),
      durability: band(2, 4),
      novelty: band(2, 4),
      generalizability: band(2, 4),
      processNotOutcome: band(3, 5),
    },
    rationale:
      "A clean process caution (skip the first 10 minutes of a listing) confirmed twice — recurrence met, process-flavored, plausibly general. Promote at a weak tier; durability is the soft axis given the slow, thinly-clustered recurrence.",
  },

  // M134 trade_outcome — closed a JUP long for a clear gain when funding flipped
  // negative: a PROCESS-driven exit on a deteriorating carry signal (not a
  // hindsight price target). One closed trade with a realized gain and a stated
  // decision rule — strong process-not-outcome. A single realized closed trade
  // supports a weak/moderate promote. Lean promote; soft vs retain-until-repeated.
  {
    expectedVerdict: "promote",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: band(3, 5),
      durability: band(1, 3),
      novelty: band(2, 4),
      generalizability: band(2, 4),
      processNotOutcome: band(3, 5),
    },
    rationale:
      "One closed JUP long exited on a stated funding-flip process signal (not hindsight) for a realized gain — strong process-not-outcome with a real outcome. Promote at a weak tier; soft vs retain-until-repeated.",
  },
];
