/**
 * Judge-decision benchmark — CORPUS CLUSTER E (ids M115–M134). TEST-ONLY data.
 *
 * SEPARATE from the 130-item `_world-corpus.ts` correctness eval. Like the rest
 * of the judge benchmark, every item here is engineered to survive D1–D11 in
 * `runDeterministicStage` and reach the LIVE judge, so the metric denominator is
 * the JUDGE ITSELF (decision quality, not pipeline routing).
 *
 * ── CLUSTER E THEME: RETAIN (14) + GRAY-ZONE CALIBRATION BAND (6) ─────────────
 * These are the "keep, don't promote yet" and the near-threshold calibration
 * items — the band where a too-lenient judge over-promotes. They split into:
 *   • RETAIN (stratum "trap", 14): genuine but NOT-YET-PROMOTABLE — single-
 *     instance observations the judge should keep-not-promote, and premature-
 *     but-escalated generalizations (2 anchors so they clear D7, but thin
 *     durability / generalizability so the JUDGE should retain rather than
 *     promote).
 *   • GRAY (stratum "gray", 6): SOFT-scored points sitting on a single rubric
 *     edge — grounding-edge (conf 0.90 n=1), novelty-edge (high cosine vs a
 *     seeded predecessor), regime-inflection (buy-the-dip authored as a bear
 *     turn begins → low durability), generalizability-edge (narrow vs broad
 *     abstraction), slow-recurrence (2 anchors, 2nd sighting > 7 days), and a
 *     promote/retain durability boundary.
 *
 * ── ESCALATION CONTRACT (every item MUST escalate; design §1) ────────────────
 *   seedGemmaCandidate (door bypassed) + clean text (no live secrets/state) +
 *   ≥1 live execution anchor + (generalization kinds: trade_lesson / risk_rule /
 *   strategy_lesson / *pattern* / *heuristic*) ≥2 OWN distinct executionId
 *   anchors (clears D7 recurrence) + unique content_hash + cosine managed +
 *   importance ≥3 + confidence ≥0.30 + NULL/future TTL ⇒ escalate → live judge.
 *
 * RETAIN that uses a GENERALIZATION kind (trade_lesson / risk_rule /
 * strategy_lesson / *pattern*) carries 2 own anchors so it CLEARS D7 and the
 * RETAIN decision is the JUDGE's, not a deterministic premature_generalization
 * terminal. Single-instance retains use NON-generalization kinds (observation /
 * market_note / trade_outcome / protocol_fact / user_preference), which are D7-
 * exempt and so need only one anchor.
 *
 * ── NOVELTY-EDGE PREDECESSOR (M130) ──────────────────────────────────────────
 * The novelty-edge item seeds an ACTIVE predecessor (real-Gemma entry) at high
 * cosine. To guarantee it ESCALATES regardless of the exact live cosine, the
 * candidate carries a NEW number the predecessor lacks, so the Graphiti
 * `differsOnNumberOrDate` guardrail flips a would-be D5 dup into an escalation —
 * while the agent-facing text remains a genuine "near-dup but arguably novel"
 * calibration probe for the judge. The number does NOT pre-decide the verdict;
 * the judge must still weigh novelty vs redundancy.
 *
 * IDS ARE OPAQUE (design §99): the M-codes encode NO verdict/kind semantics; the
 * oracle reasons from the agent-facing text alone.
 *
 * Pure module: typed const data only. No DB, no embeddings, no I/O, no `as any`,
 * no policy imports.
 */

import type { JudgeCorpusItem } from "./_judge-corpus.js";

/**
 * Cluster E. Appended into `JUDGE_CORPUS.items` by the Wave-3 wiring agent.
 * RETAIN items use stratum "trap" (N=3 modal-vote, because the promote/retain
 * line is exactly where live-LLM jitter and over-promotion live); GRAY items use
 * stratum "gray" (N=3, SOFT-scored near a threshold).
 */
export const CLUSTER_E: JudgeCorpusItem[] = [
  // ───────────────────────────────────────────────────────────────────────────
  // RETAIN (14) — keep-don't-promote. Single-instance observations + premature-
  // but-escalated generalizations (thin durability / generalizability).
  // ───────────────────────────────────────────────────────────────────────────

  // M115 — a one-off structural observation. Noticed ONCE; durable enough to keep
  // for later corroboration but far too thin to promote as a rule. NON-
  // generalization kind (observation) → D7-exempt → one anchor escalates.
  {
    id: "M115",
    kind: "observation",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "JUP perp open interest climbed while spot price stayed flat one session",
      summary:
        "During one session JUP perpetual open interest rose noticeably while the spot price barely moved, hinting at positioning building under a quiet tape.",
      contentMd:
        "Single-session observation, not yet a rule: OI built up without a matching spot move. Worth keeping to see whether it precedes a directional break, but one sighting proves nothing.",
      importance: 4,
      confidence: 0.55,
    },
  },

  // M116 — a single durable market note. A real, specific structural fact about
  // one venue, seen once; keep it, but it is an isolated note, not a promotable
  // generalized lesson. NON-generalization kind.
  {
    id: "M116",
    kind: "market_note",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Raydium WIF/SOL pool depth thinned sharply after the US session close",
      summary:
        "On one day the WIF/SOL Raydium pool's near-touch depth dropped off after the US close, so the same order size moved price more in late hours.",
      contentMd:
        "Observed once: liquidity thinned post-close on this pool. A useful note to revisit, but a single day is not enough to promote a time-of-day liquidity rule.",
      importance: 5,
      confidence: 0.6,
    },
  },

  // M117 — a single closed-trade outcome with a thin takeaway. The trade is real
  // and closed, but the inference drawn from it is weakly supported by one
  // result; retain the outcome, do not promote the takeaway as a strategy.
  {
    id: "M117",
    kind: "trade_outcome",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Closed a POPCAT spot position near flat after a failed continuation",
      summary:
        "A POPCAT spot position was exited roughly at break-even when the expected continuation did not materialize after the first leg up.",
      contentMd:
        "One closed trade, near-flat result. The tentative read is that the first leg lacked follow-through volume, but a single break-even exit does not justify a promoted rule yet.",
      importance: 5,
      confidence: 0.6,
    },
  },

  // M118 — a single, slightly-uncertain protocol fact. A concrete claim about one
  // protocol, but stated tentatively from one observation; keep it as a note
  // pending confirmation rather than promote it as an established fact.
  {
    id: "M118",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "Drift funding appeared to settle hourly on the SOL-PERP market",
      summary:
        "Observation suggests Drift's SOL-PERP funding settled on an hourly cadence during the watched window, but this was inferred from one stretch, not confirmed against docs.",
      contentMd:
        "Tentative protocol detail from a single observation window. Keep it to cross-check later; do not promote an unverified cadence as an established protocol fact.",
      importance: 5,
      confidence: 0.5,
    },
  },

  // M119 — a soft, weakly-evidenced user preference. A leaning expressed once,
  // without a clear standing instruction; keep it as a hint, do not promote it
  // into a hard preference the agent enforces.
  {
    id: "M119",
    kind: "user_preference",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "User seemed to lean away from low-liquidity memecoins in one exchange",
      summary:
        "In one exchange the user voiced mild discomfort with thinly-traded memecoins, but did not state a firm rule to avoid them.",
      contentMd:
        "A single soft signal, not an explicit standing instruction. Worth keeping as a hint, but promoting it into an enforced preference would over-read one offhand remark.",
      importance: 4,
      confidence: 0.5,
    },
  },

  // M120 — a one-off correlation noticed across two assets. Interesting, but one
  // co-movement is not a relationship; retain to watch, do not promote a pairing
  // rule. NON-generalization kind (observation).
  {
    id: "M120",
    kind: "observation",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "BONK and WIF moved together on one risk-off afternoon",
      summary:
        "On a single risk-off afternoon BONK and WIF sold off in near lock-step, suggesting shared memecoin-beta exposure that day.",
      contentMd:
        "One co-movement is not a stable correlation. Keep the observation to see whether the pairing holds, but a single afternoon cannot promote a basket-hedging rule.",
      importance: 4,
      confidence: 0.55,
    },
  },

  // M121 — a PREMATURE generalization. strategy_lesson IS a generalization kind →
  // two own anchors clear D7 so it ESCALATES, but the abstraction rests on only
  // two thin sightings with weak process grounding → the JUDGE should retain, not
  // promote. (The anchors clear the gate; they do NOT make the generalization
  // durable — that is the retain trap.)
  {
    id: "M121",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 2,
    suggest: {
      title: "Rotating from SOL into JUP early in the day tended to outperform",
      summary:
        "On two occasions rotating from SOL into JUP in the first hour of the day looked better than holding SOL, hinting at an intraday rotation edge.",
      contentMd:
        "Two sightings only, both early-session, no clear causal mechanism. The pattern is suggestive but not yet durable or general; keep watching before promoting a rotation rule.",
      importance: 6,
      confidence: 0.55,
    },
  },

  // M122 — a PREMATURE trade_lesson (generalization kind via "lesson"). Two anchors
  // clear D7; the lesson is drawn from two near-identical setups with no proven
  // edge across regimes → retain, do not promote.
  {
    id: "M122",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 2,
    suggest: {
      title: "Trimming half a WIF position into strength felt better than holding full size",
      summary:
        "Twice, trimming half of a WIF position into a sharp move up reduced give-back versus holding the full size into the reversal.",
      contentMd:
        "Two similar trims, both in the same choppy stretch. The give-back avoided is real but small-sample and regime-specific; not yet a promotable sizing lesson.",
      importance: 6,
      confidence: 0.58,
    },
  },

  // M123 — a PREMATURE risk_rule (generalization kind via "risk"). Two anchors
  // clear D7; the proposed rule is extrapolated from two volatility spikes with no
  // backtest or durability → the judge should retain pending more evidence.
  {
    id: "M123",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 2,
    suggest: {
      title: "Cutting perp leverage when funding turns sharply positive avoided two squeezes",
      summary:
        "On two occasions reducing perp leverage as funding flipped sharply positive sidestepped a subsequent long squeeze on SOL-PERP.",
      contentMd:
        "Two avoided squeezes, both in one high-funding window. The intuition is sound but two correlated events do not establish a durable leverage rule; retain for now.",
      importance: 6,
      confidence: 0.58,
    },
  },

  // M124 — a PREMATURE pattern (generalization kind via "pattern"). Two anchors
  // clear D7; the entry pattern is built from two narrow examples → retain, the
  // judge should not promote a pattern from so little.
  {
    id: "M124",
    kind: "entry_pattern",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 2,
    suggest: {
      title: "A quick reclaim of the prior swing high preceded two POPCAT continuations",
      summary:
        "Twice, POPCAT reclaiming its prior swing high within a few minutes was followed by a continuation leg, suggesting a fast-reclaim entry trigger.",
      contentMd:
        "Two clean reclaims, both same asset, same week. Encouraging but thin: no failed-reclaim counter-examples observed yet, so the pattern is not durable enough to promote.",
      importance: 6,
      confidence: 0.55,
    },
  },

  // M125 — a single structural observation about execution. Real and useful, but
  // a one-time measurement; retain, don't promote a routing rule from one data
  // point. NON-generalization kind.
  {
    id: "M125",
    kind: "observation",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "A Jupiter route for a mid-size SOL→JUP swap split across three pools once",
      summary:
        "On one mid-size SOL→JUP swap the Jupiter route fanned out across three pools to reduce price impact, more splitting than smaller swaps showed.",
      contentMd:
        "A single routing observation. It hints that size triggers multi-pool splitting, but one swap is not enough to promote a size-vs-route-shape rule.",
      importance: 4,
      confidence: 0.55,
    },
  },

  // M126 — a single regime-tinted market note. A specific observed condition, once;
  // keep it, but a one-day reading is not a promotable regime signal. NON-
  // generalization kind.
  {
    id: "M126",
    kind: "market_note",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "SOL realized volatility compressed into a tight range for one quiet day",
      summary:
        "For one quiet day SOL's realized volatility compressed and price coiled in a narrow range, the kind of lull that sometimes precedes expansion.",
      contentMd:
        "A single quiet day. Volatility compression sometimes precedes a move, but reading one day as a regime signal would over-promote a routine lull.",
      importance: 5,
      confidence: 0.6,
    },
  },

  // M127 — a narrow single protocol fact. Concrete and correct-as-observed, but
  // scoped to one specific case; retain rather than promote it as a general
  // protocol rule. NON-generalization kind.
  {
    id: "M127",
    kind: "protocol_fact",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 1,
    suggest: {
      title: "This specific BONK pool charged a higher swap fee tier than the default",
      summary:
        "One BONK liquidity pool was observed on a higher swap-fee tier than the venue's default, which raised the effective cost of routing through it.",
      contentMd:
        "A narrow, pool-specific fact seen once. Accurate for that pool, but promoting it as a general fee expectation would over-generalize from a single pool.",
      importance: 5,
      confidence: 0.6,
    },
  },

  // M128 — a PREMATURE narrow-scope generalization. strategy_lesson (generalization
  // kind) with two anchors clears D7; the rule is genuine but its scope is so
  // narrow (one asset, one time-of-day) that it reads as not-yet-durable → retain.
  {
    id: "M128",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "trap",
    ownAnchorCount: 2,
    suggest: {
      title: "Waiting for the first hourly close before acting on JUP signals reduced whipsaw twice",
      summary:
        "Twice, waiting for the first completed hourly candle before acting on a JUP signal avoided getting whipsawed by an early intrabar fakeout.",
      contentMd:
        "Two avoided whipsaws, both JUP, both early session. Plausible and process-flavored, but the scope is narrow and the sample small; keep, do not yet promote a timing rule.",
      importance: 6,
      confidence: 0.6,
    },
  },

  // ───────────────────────────────────────────────────────────────────────────
  // GRAY-ZONE CALIBRATION BAND (6, stratum "gray") — SOFT, each on one rubric
  // edge. These are deliberately ambiguous so the judge's calibration is
  // measured, not its ability to call an easy case.
  // ───────────────────────────────────────────────────────────────────────────

  // M129 — GROUNDING-EDGE. A high stated confidence (0.90) attached to a single
  // observation with no corroboration. The confidence CLAIM is high but the
  // GROUNDING is thin (n=1) — the judge should weight grounding over the claimed
  // confidence and lean reject. NON-generalization kind so n=1 escalates.
  {
    id: "M129",
    kind: "observation",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 1,
    suggest: {
      title: "A single large WIF buy print marked the exact local bottom",
      summary:
        "One conspicuously large WIF buy print coincided with the exact local low, which felt like smart-money accumulation timing the bottom.",
      contentMd:
        "High felt-confidence, but this is a single print read after the fact. One coincidence does not establish that large prints mark bottoms; the strong confidence is not earned by the evidence.",
      importance: 5,
      confidence: 0.9,
    },
  },

  // M130 — NOVELTY-EDGE. An ACTIVE predecessor states the same idea; this item
  // restates it with a slightly different framing AND a NEW number. The new number
  // guarantees escalation (Graphiti guardrail flips a would-be D5 dup), while the
  // text stays close enough that whether the judge treats it as genuinely novel or
  // as redundant is the calibration question. NON-generalization kind (the
  // predecessor seeding, not D7, is what this probe exercises).
  {
    id: "M130",
    kind: "market_note",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 1,
    predecessor: {
      kind: "market_note",
      title: "SOL tends to lead the memecoin basket on up moves",
      summary:
        "On up moves SOL tends to turn higher before the memecoin basket (WIF, BONK, POPCAT) follows, so SOL strength often leads the basket.",
    },
    suggest: {
      title: "SOL led the memecoin basket higher with about a 15 minute lead",
      summary:
        "Watching SOL versus the memecoin basket, SOL turned up roughly 15 minutes before WIF, BONK, and POPCAT followed on the latest up move.",
      contentMd:
        "Same leads-the-basket idea as before, now with an approximate lead time attached. Whether the added timing detail is a genuinely novel refinement or just a restatement is the open question for the judge.",
      importance: 5,
      confidence: 0.6,
    },
  },

  // M131 — REGIME-INFLECTION. A "buy every dip" generalization authored exactly as
  // the regime turns from range to bear. It generalized fine in the prior up-tape
  // but its durability is collapsing as the regime inflects — a low-durability
  // promote that the judge should be wary of. trade_lesson is a generalization
  // kind → two anchors clear D7.
  {
    id: "M131",
    kind: "trade_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Buying SOL dips kept working, so keep buying every dip",
      summary:
        "Buying SOL dips paid off repeatedly through the recent up-tape, suggesting the agent should keep buying every dip going forward.",
      contentMd:
        "The dip-buying edge was real while the trend was up, but it is being authored just as breadth deteriorates and the regime turns down. Its durability across the coming regime is doubtful.",
      importance: 6,
      confidence: 0.62,
    },
  },

  // M132 — GENERALIZABILITY-EDGE. A real, narrow observation phrased as a BROAD
  // rule. The underlying fact is fine for the one case; the question is whether the
  // judge promotes the broad claim or recognizes the scope is too narrow to
  // generalize. strategy_lesson (generalization kind) → two anchors clear D7.
  {
    id: "M132",
    kind: "strategy_lesson",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Mint-authority-renounced tokens are the safe ones to size into",
      summary:
        "Two tokens whose mint authority was renounced behaved well, generalized into a rule that renounced-mint tokens are the safe ones to size into.",
      contentMd:
        "Renounced mint authority removes one specific rug vector, but it does not make a token broadly safe (liquidity, holders, LP locks all still matter). The narrow true fact is stretched into an over-broad safety rule.",
      importance: 6,
      confidence: 0.6,
    },
  },

  // M133 — SLOW-RECURRENCE. Two anchors clear D7, but the two sightings are far
  // apart in time (the 2nd more than a week after the 1st). The recurrence is
  // technically met yet weakly clustered in time, so its durability/recurrence
  // strength is borderline — promote vs retain is genuinely ambiguous. risk_rule
  // (generalization kind) → two anchors.
  {
    id: "M133",
    kind: "risk_rule",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 2,
    suggest: {
      title: "Skipping new memecoin listings in the first ten minutes avoided two bad fills",
      summary:
        "Twice, waiting out the first ten minutes of a fresh memecoin listing avoided a terrible fill, but the two instances were more than a week apart.",
      contentMd:
        "Two confirmations of the same caution, but separated by over a week with nothing in between. The recurrence is real yet slow and thinly clustered, so whether it is durable enough to promote is borderline.",
      importance: 6,
      confidence: 0.6,
    },
  },

  // M134 — PROMOTE/RETAIN DURABILITY BOUNDARY. A single closed trade with a
  // genuinely process-flavored read (not pure hindsight) sitting right on the line
  // between a promotable lesson and a keep-for-now outcome. The judge's call here
  // calibrates where promote starts. NON-generalization kind (trade_outcome).
  {
    id: "M134",
    kind: "trade_outcome",
    entryVia: "seedGemmaCandidate",
    stratum: "gray",
    ownAnchorCount: 1,
    suggest: {
      title: "Exiting a JUP position when funding flipped negative locked in the gain",
      summary:
        "A JUP perp long was closed for a clear gain when funding flipped negative, a process-driven exit on a deteriorating carry signal rather than a price target.",
      contentMd:
        "One closed trade, but the exit followed a stated process signal (funding flip) rather than hindsight. Whether one clean process-driven win is enough to promote, or should be retained until repeated, is the calibration question.",
      importance: 6,
      confidence: 0.64,
    },
  },
];
