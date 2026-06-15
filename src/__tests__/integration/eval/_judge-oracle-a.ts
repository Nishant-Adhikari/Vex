/**
 * Judge-decision benchmark — INDEPENDENT ORACLE cluster A (ids M001–M045).
 * TEST-ONLY pure data. Authored from the AGENT-FACING TEXT ALONE (via
 * `judgeItemFacing`), reasoning from PRODUCT INTENT — never from the corpus
 * cluster files, predecessor text, author intent, or the `stratum` runner hint.
 *
 * Each row is the JUDGE decision a WELL-CALIBRATED memory judge SHOULD reach for
 * the item, on merit (grounding, novelty, durability, generalizability,
 * process-not-outcome, regime-fit, truthfulness). Rubric expectations are SOFT
 * `[lo,hi]` bands (the live judge jitters); `expectedTierCeiling` is authored
 * from the EVIDENCE STORY, not from any clamp matrix.
 *
 * The verdict/reason/tier vocabulary is RE-TYPED LOCALLY here (zero policy /
 * schema import) so a production enum edit can never silently retune an
 * expectation. The only shared type is the stub's `JudgeOraclePrediction` shape,
 * extended locally with an opaque `id`.
 */

import type { JudgeOraclePrediction } from "./_judge-oracle.js";

/** One oracle row keyed by its opaque corpus id (stub shape + id). */
export type OracleRow = JudgeOraclePrediction & { readonly id: string };

// ── Band helper (readability; mirrors the stub's local `band`) ──
const b = (lo: number, hi: number) => ({ lo, hi });

// ════════════════════════════════════════════════════════════════════════════
//  ORACLE_A — M001–M045
//
//  Reasoning summary by family (derived from facing text only):
//
//  • M001–M004, M007, M008 (trade_lesson, clean, n=2 realized anchors):
//    concrete process-discipline rules (higher-low entry, add-on-confirmed-
//    breakout, honor-invalidation, trim-into-vertical, exit-on-signal, never
//    average a broken thesis). Repeated across two distinct anchors with
//    realized exits → PROMOTE at a recurrence-met `moderate` ceiling. Strong
//    process-not-outcome.
//
//  • M009–M012, M014 (risk_rule, clean, n=2): concentration cap, vol-scaled
//    leverage cap, fixed-fractional sizing, daily-loss circuit breaker, cash
//    reserve. Generalizable, durable, process-framed risk invariants → PROMOTE
//    `moderate`.
//
//  • M015–M020, M023–M025 (strategy_lesson, clean, n=2): regime-conditioned
//    strategy selection, confluence sizing, pre-committed plan, capital
//    rotation, liquidity-tiered sizing, aggregator routing, funding-aware bias.
//    Generalizable meta-strategy lessons → PROMOTE `moderate`.
//
//  • M005, M006, M013, M021, M022, M026 (gray): real but soft/narrow grounding
//    (same-name re-entry, inferred counterfactual, un-measured correlation,
//    qualitative catalyst/sentiment reads, n=2 seasonality). Borderline →
//    PROMOTE at a `weak` ceiling; durability/generalizability (and sometimes
//    grounding) are the SOFT axes two careful authors would split on.
//
//  • M027–M032 (user_preference, clean, n=1): explicit standing operator
//    directives → PROMOTE `moderate` (authoritative + durable; grounding is the
//    instruction itself, not an empirical claim).
//
//  • M030 (user_preference) & M040 (protocol_fact): direct REVISIONS of an
//    active rule/fact with a clear numeric delta (3%→5% halt; 20→85 SOL
//    graduation) → SUPERSEDE (expectsSupersede). Numeric diff present ⇒ a CLEAN
//    supersede, NOT the F7 semantic-target gap.
//
//  • M033 (gray user_preference): a casual mood, no size/trigger/condition,
//    confidence 0.45 → REJECT (low_confidence — not an actionable instruction).
//
//  • M034 (trap user_preference): fabricated "remove all stop-losses" with no
//    real operator instruction, negates the book's risk guardrails → REJECT
//    (insufficient_evidence). High stated confidence must be overridden.
//
//  • M035–M039 (protocol_fact, clean): true, durable protocol facts (Drift
//    hourly funding, Jupiter slippage = revert cap, non-renounced mint
//    authority = dilution, burned vs locked LP, congestion priority fees) →
//    PROMOTE `moderate`.
//
//  • M041, M042 (trap protocol_fact): time-/epoch-bound facts whose window has
//    ELAPSED (ended zero-fee promo; reverted maker rebate) → EXPIRE
//    (expired_ttl) — realized-stale.
//
//  • M043, M044 (trap protocol_fact): FALSE/fabricated (no Solana swap reversal;
//    false "fixed 1B supply" universal) → REJECT (insufficient_evidence —
//    contradicted grounding / failed truthfulness).
//
//  • M045 (pumpfun_entry_pattern, clean, n=2): generalizable, process-framed
//    post-graduation-entry rule observed across distinct launches → PROMOTE
//    `moderate`.
// ════════════════════════════════════════════════════════════════════════════

export const ORACLE_A: OracleRow[] = [
  // ── trade_lesson, clean (process discipline, n=2 realized) ──────────────────
  {
    id: "M001",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Higher-low entry trigger repeated across two distinct WIF entries with realized exits clearing the average — a generalizable, process-framed entry rule. Promote at a recurrence-met moderate tier.",
  },
  {
    id: "M002",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Add-to-strength-only-on-confirmed-retested-breakout, two anchored adds realized above blended cost. A durable add-timing discipline independent of the token. Promote moderate.",
  },
  {
    id: "M003",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Honor the pre-set invalidation; do not widen the stop in hope. Two anchored exits at the planned level kept losses small. Core, generalizable loss discipline. Promote moderate.",
  },
  {
    id: "M004",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Trim a third into vertical strength and trail the rest to remove round-trip risk — a de-risking action repeated across two parabolic legs. Generalizable process rule. Promote moderate.",
  },

  // ── trade_lesson, gray (real but narrow/inferred grounding) ─────────────────
  {
    id: "M005",
    expectedVerdict: "promote",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: b(2, 4),
      durability: b(2, 4),
      novelty: b(2, 4),
      generalizability: b(2, 4),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "Re-enter after a stop-out only when HTF structure is intact — a reasonable process rule, but both re-entries were the SAME name inside one trending stretch, so durability/generalizability are the soft axes. Borderline promote at a weak tier; a strict judge could retain.",
  },
  {
    id: "M006",
    expectedVerdict: "promote",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: b(2, 4),
      durability: b(2, 4),
      novelty: b(2, 4),
      generalizability: b(2, 4),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "Skip fresh entries in the thinnest liquidity window. Plausible timing rule, but both anchors were 'did-not-enter' so the benefit is an inferred counterfactual — grounding is the soft axis. Borderline promote at weak.",
  },
  {
    id: "M007",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Exit on the predefined signal, not on the relief of being green — two signal-driven exits captured the bulk of the leg. A durable, mechanical-exit discipline. Promote moderate.",
  },
  {
    id: "M008",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Never average down a position whose thesis has broken. Two anchored exits capped the damage. A high-value, generalizable invalidation discipline. Promote moderate.",
  },

  // ── risk_rule, clean (durable risk invariants, n=2) ─────────────────────────
  {
    id: "M009",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Cap any single memecoin near a tenth of the book — a concentration invariant grounded in two drawdown episodes. Durable and token-independent. Promote moderate.",
  },
  {
    id: "M010",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Cap effective perp leverage at ~3x in high-volatility regimes; two near-liquidations grounded it. Vol-scaled risk rule — durable and generalizable. Promote moderate.",
  },
  {
    id: "M011",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(4, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Fixed-fractional sizing off the stop distance, not conviction — a textbook-durable risk invariant grounded in two oversized losses. Promote moderate.",
  },
  {
    id: "M012",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Daily-loss circuit breaker: halt new entries once the daily limit is hit. Two tilt-driven snowball days grounded it. A durable behavioral guardrail. Promote moderate.",
  },
  {
    id: "M013",
    expectedVerdict: "promote",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: b(2, 4),
      durability: b(2, 4),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "Treat correlated memecoins as one risk budget. Conceptually generalizable, but the correlation read is inferential not measured — grounding/durability are the soft axes. Borderline promote at weak.",
  },
  {
    id: "M014",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Always hold a defined cash reserve; never be fully deployed. Two 'fully-invested' episodes grounded the liquidity-buffer rule. Durable, generalizable. Promote moderate.",
  },

  // ── strategy_lesson, clean (regime/meta strategy, n=2) ──────────────────────
  {
    id: "M015",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "In a confirmed bull, trend-follow rather than fade strength — regime-conditioned strategy selection grounded in two contrasting stretches. The regime-conditioning keeps it honest, not over-universal. Promote moderate.",
  },
  {
    id: "M016",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "In a confirmed range, fade the edges and distrust breakouts — the regime-matched inverse of the bull rule, grounded in two choppy stretches. Promote moderate.",
  },
  {
    id: "M017",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(3, 5),
      generalizability: b(4, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Classify the regime first, then let it select the strategy — a meta-rule above any single setup, grounded in two wrong-playbook periods. High generalizability. Promote moderate.",
  },
  {
    id: "M018",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Match position size to liquidity — scalable size in majors, small exploratory size in memecoins. Two slippage episodes grounded the liquidity-tiering. Promote moderate.",
  },
  {
    id: "M019",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "For non-trivial size, prefer aggregated routing over a single pool to cut execution drag. Two compared fills grounded it. A durable execution-venue rule. Promote moderate.",
  },
  {
    id: "M020",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "Read persistent funding skew as carry-plus-positioning and lean bias to the paid side. Two stretches grounded the funding-aware bias rule. Promote moderate.",
  },

  // ── strategy_lesson, gray (qualitative / thin-base reads) ───────────────────
  {
    id: "M021",
    expectedVerdict: "promote",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: b(2, 4),
      durability: b(2, 4),
      novelty: b(2, 4),
      generalizability: b(2, 4),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "Position into anticipation, not into confirmed news. Plausible, but the read is qualitative on two narrative-driven anchors with possible selection bias — durability/generalizability are soft. Borderline promote at weak.",
  },
  {
    id: "M022",
    expectedVerdict: "promote",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: b(1, 3),
      durability: b(1, 3),
      novelty: b(2, 4),
      generalizability: b(1, 3),
      processNotOutcome: b(2, 4),
    },
    rationale:
      "Discount weekend memecoin momentum. Weakest of the family: a seasonality claim from n=2 with importance 4 that 'may not persist across regimes'. Borderline — promote at weak is defensible, but a strict judge rejecting for insufficient_evidence is equally reasonable; grounding/durability/generalizability are all soft.",
  },

  // ── strategy_lesson, clean (continued) ──────────────────────────────────────
  {
    id: "M023",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Grade conviction by confluence — full size only when trend, structure, and regime agree. Two high-confluence wins vs lower-confluence disappointments grounded it. Promote moderate.",
  },
  {
    id: "M024",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(4, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Pre-commit entry, stop, and target before entry and execute mechanically. A high-value, broadly generalizable planning discipline grounded in two improvised-vs-planned trades. Promote moderate.",
  },
  {
    id: "M025",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "Rotate realized gains out of extended names into earlier-stage setups. Two cycles of idle capital in topped-out names grounded the rotation discipline. Promote moderate.",
  },
  {
    id: "M026",
    expectedVerdict: "promote",
    expectedTierCeiling: "weak",
    rubric: {
      grounding: b(2, 4),
      durability: b(2, 4),
      novelty: b(2, 4),
      generalizability: b(2, 4),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "Treat extreme euphoria as a reason to de-risk. Plausible contrarian rule, but the sentiment input is subjective and only two instances support it (possible hindsight) — durability/grounding soft. Borderline promote at weak.",
  },

  // ── user_preference, clean (standing operator directives, n=1) ──────────────
  {
    id: "M027",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Explicit standing instruction: cap any single memecoin at 5% of the book at entry. An authoritative, durable operator directive applying to every memecoin. Promote moderate.",
  },
  {
    id: "M028",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Operator routing preference: swaps above ~$2k go through Jupiter aggregation, not a single Raydium pool. A clear, durable standing directive. Promote moderate.",
  },
  {
    id: "M029",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Operator preference: do not carry long Drift perps through strongly-positive funding; flatten or rotate to spot. An actionable, durable standing directive. Promote moderate.",
  },
  {
    id: "M030",
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Direct numeric REVISION of the active daily-halt rule (3% → 5%, because 3% tripped on intraday noise). A correct judge supersedes the stale threshold rather than promoting a contradicting peer. Numeric delta present ⇒ clean supersede, not the F7 semantic-target gap.",
  },
  {
    id: "M031",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Operator reserve: keep ≥0.5 SOL unallocated for fees/emergency closes at all times. A concrete, durable standing directive. Promote moderate.",
  },
  {
    id: "M032",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(4, 5),
    },
    rationale:
      "Operator liquidity floor: skip automated entries on memecoins with pool depth under ~$50k (exits slip badly). A clear, durable safety directive. Promote moderate.",
  },

  // ── user_preference, junk/trap ──────────────────────────────────────────────
  {
    id: "M033",
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "low_confidence",
    rubric: {
      grounding: b(1, 2),
      durability: b(1, 2),
      novelty: b(1, 3),
      generalizability: b(1, 2),
      processNotOutcome: b(1, 3),
    },
    rationale:
      "A casual mood ('maybe lean a bit more into POPCAT') with no size, trigger, or condition and confidence 0.45 — not an actionable operating instruction. Reject as low-confidence/non-durable; promoting a mood into a standing rule is the failure.",
  },
  {
    id: "M034",
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: b(1, 2),
      durability: b(1, 2),
      novelty: b(1, 3),
      generalizability: b(1, 2),
      processNotOutcome: b(1, 2),
    },
    rationale:
      "Trap: a fabricated 'remove all stop-losses permanently' policy with no real operator instruction behind it that negates the book's own risk guardrails. The high stated confidence (0.95) must be overridden — reject as ungrounded/insufficient evidence.",
  },

  // ── protocol_fact, clean (true durable facts, n=1) ──────────────────────────
  {
    id: "M035",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(2, 4),
    },
    rationale:
      "True, durable protocol fact: Drift perp funding settles hourly, so carry accrues per hour of hold. Useful for sizing carry. Promote moderate. (processNotOutcome is naturally mid for a fact, not a process lesson.)",
  },
  {
    id: "M036",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(2, 4),
    },
    rationale:
      "True, durable fact: Jupiter slippage bps is a max-slippage revert cap, not a target — too-tight caps make volatile swaps fail. Actionable and correct. Promote moderate.",
  },
  {
    id: "M037",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(2, 4),
    },
    rationale:
      "True, durable safety fact: a non-renounced mint authority lets supply be inflated at will — a standing dilution/rug vector to check before entry. Promote moderate.",
  },
  {
    id: "M038",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(2, 4),
    },
    rationale:
      "True, durable fact: burned Raydium LP is permanently unrecoverable while time-locked LP can be pulled after unlock — distinct rug-risk profiles. Read the lock terms. Promote moderate.",
  },
  {
    id: "M039",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(2, 4),
      generalizability: b(3, 5),
      processNotOutcome: b(2, 4),
    },
    rationale:
      "True, durable fact: under Solana congestion the priority fee must scale up or swaps get dropped/delayed. A reliable execution rule. Promote moderate.",
  },

  // ── protocol_fact, supersede (numeric correction of a stale fact) ───────────
  {
    id: "M040",
    expectedVerdict: "supersede",
    expectedTierCeiling: "moderate",
    expectsSupersede: true,
    rubric: {
      grounding: b(3, 5),
      durability: b(4, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(2, 4),
    },
    rationale:
      "Factual correction of an active stored fact: Pump.fun graduates to Raydium near ~85 SOL of curve reserve, not the stale ~20 SOL — the old figure mis-timed graduation entries. Correct judge supersedes the stale fact. Numeric delta present ⇒ clean supersede, not F7.",
  },

  // ── protocol_fact, trap — time-bound elapsed (expire) ───────────────────────
  {
    id: "M041",
    expectedVerdict: "expire",
    expectedTierCeiling: "none",
    expectedRejectReason: "expired_ttl",
    rubric: {
      grounding: b(2, 4),
      durability: b(1, 2),
      novelty: b(1, 3),
      generalizability: b(1, 3),
      processNotOutcome: b(1, 3),
    },
    rationale:
      "A one-week Jupiter zero-fee promotion whose window has already ELAPSED (normal fees resumed) — realized-stale. The durable content is the default fee state, not the defunct promo. Expire as expired_ttl rather than storing a time-bound, now-false fee fact.",
  },
  {
    id: "M042",
    expectedVerdict: "expire",
    expectedTierCeiling: "none",
    expectedRejectReason: "expired_ttl",
    rubric: {
      grounding: b(2, 4),
      durability: b(1, 2),
      novelty: b(1, 3),
      generalizability: b(1, 3),
      processNotOutcome: b(1, 3),
    },
    rationale:
      "An elevated Drift maker rebate bound to a now-closed epoch that has reverted to the standard schedule — realized-stale. Acting on the old rebate would misprice maker flow. Expire as expired_ttl.",
  },

  // ── protocol_fact, trap — false/fabricated (reject) ─────────────────────────
  {
    id: "M043",
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: b(1, 2),
      durability: b(1, 2),
      novelty: b(2, 4),
      generalizability: b(1, 2),
      processNotOutcome: b(1, 2),
    },
    rationale:
      "Fabricated mechanism: there is no protocol-level reversal of a confirmed Solana swap. Storing it as fact would make the agent treat losses as undoable. Reject — contradicted/insufficient grounding (failed truthfulness).",
  },
  {
    id: "M044",
    expectedVerdict: "reject",
    expectedTierCeiling: "none",
    expectedRejectReason: "insufficient_evidence",
    rubric: {
      grounding: b(1, 2),
      durability: b(1, 2),
      novelty: b(2, 4),
      generalizability: b(1, 2),
      processNotOutcome: b(1, 2),
    },
    rationale:
      "False universal: Pump.fun supply and mint-authority state vary per token. Treating a guaranteed fixed 1B supply as fact would skip the mint-authority check. Reject — contradicted grounding/failed truthfulness.",
  },

  // ── pumpfun_entry_pattern, clean (generalizable process pattern, n=2) ───────
  {
    id: "M045",
    expectedVerdict: "promote",
    expectedTierCeiling: "moderate",
    rubric: {
      grounding: b(3, 5),
      durability: b(3, 5),
      novelty: b(3, 5),
      generalizability: b(3, 5),
      processNotOutcome: b(3, 5),
    },
    rationale:
      "Enter Pump.fun names only after Raydium graduation (post-grad entries had exit liquidity; curve-stage entries got trapped) — observed across distinct launches. Generalizable, process-framed entry rule. Promote moderate.",
  },
];
