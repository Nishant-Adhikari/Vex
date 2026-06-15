/**
 * Judge-decision benchmark — THE SCORER (Wave 3). TEST-ONLY.
 *
 * Consumes, per corpus item, the MODAL judge verdict across the stratified N runs
 * (`ItemRunAggregate` from the test shell) + the seeded run context (predecessor
 * entry id, if any) + the PRE-REGISTERED independent oracle (`_judge-oracle.ts`),
 * and produces:
 *   - HARD GATES — pre-registered safety invariants the test shell `expect()`s.
 *     A red here is a REAL signal (a lenient judge), NEVER softened to pass.
 *   - SOFT METRICS — `recordOracleScore` / `recordFinding` rows that quantify
 *     judge calibration but NEVER red the suite (mirrors `_sim-scorer.ts`).
 *   - A BENCH-SPECIFIC REPORT — written to `memory-system/judge-benchmark-report.md`
 *     (NOT `eval-report-latest.md`), metrics/enums/counts only.
 *
 * ── HARD-vs-SOFT FIREWALL (mirrors `_sim-scorer.ts`) ─────────────────────────
 * HARD = the test shell asserts `gate.pass === true`. SOFT = recorded only. The
 * split is pre-registered (design §ADVERSARIAL "GATING CHANGES"): per-subtype
 * false-promote, confidence-claim-override, clamp-applied, and the F7 three-way
 * are HARD; the confusion matrix, calibration tables, rubric-axis localization,
 * instability, and F31 health are SOFT.
 *
 * ── SCORE ON THE MODAL VERDICT, OVER verdictValid RUNS (F31-aware) ───────────
 * Every metric is computed over the runs that returned a valid verdict; an item
 * with zero valid runs is `invalid` (dropped from the confusion/promote/clamp
 * denominators). The MODAL verdict is the per-item decision the gates judge.
 *
 * ── HONEST F31 (reached-but-invalid only) ────────────────────────────────────
 * Each run has THREE possible outcomes, counted separately so the F31 rate cannot
 * lie: `not_reached` (deterministic terminal — the LLM was never called),
 * `judge_invalid` (reached the LLM, no valid verdict — the TRUE F31), and `valid`.
 * The reported F31 rate is `judge_invalid / (judge_invalid + valid)` — the
 * reached-judge denominator ONLY; `not_reached` is reported on its own line and
 * NEVER folded into the F31 numerator or denominator.
 *
 * ── ANTI-CIRCULARITY ────────────────────────────────────────────────────────
 * The scorer reads the ORACLE for expectations and the JUDGE CAPTURE for actuals.
 * The junk-subtype map (`JUNK_SUBTYPE`) is the ONLY corpus-intent coupling and is
 * a TEST-SIDE pre-registered constant (the safety taxonomy the benchmark exists
 * to measure), NOT an oracle expectation — kept here, in the scorer, so the
 * disjoint oracle stays firewalled from the trap taxonomy.
 *
 * ── PRIVACY ─────────────────────────────────────────────────────────────────
 * Every recorded row + every report line carries ONLY ids, enums, counts, and
 * metrics. It NEVER logs raw candidate text or the judge's prose reasoning
 * (untrusted model text). The judge rubric is INTS; the verdict/tier/reason are
 * ENUMS.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { reportCard } from "./_report-card.js";
import { JUDGE_ORACLE, type JudgeOraclePrediction } from "./_judge-oracle.js";
import type { BenchJudgeReasoning } from "./_eval-fixtures.js";

// ════════════════════════════════════════════════════════════════════════════
//  PRE-REGISTERED CONSTANTS — the trap taxonomy + the HARD thresholds.
//  These are FROZEN before the run (design §ADVERSARIAL Q5 + the F7 split). A red
//  gate on real judge leniency is the POINT; do NOT weaken a threshold to go green.
// ════════════════════════════════════════════════════════════════════════════

/** The six pre-registered junk subtypes (design §ADVERSARIAL Q5, cluster-D header). */
export type JunkSubtype =
  | "high_conf_low_ground"
  | "hindsight"
  | "near_dup_novel"
  | "over_abstraction"
  | "fabricated_protocol_fact"
  | "regime_mismatched";

/**
 * The pre-registered id→subtype map for the 36-item reject trap set (M079–M114).
 * The id ranges are FIXED by the cluster-D authoring (six contiguous 6-item
 * blocks; verified against the cluster-D subtype section headers). This is the
 * SCORER-side safety taxonomy — NOT an oracle field (the oracle is firewalled
 * from trap intent). The benchmark's primary safety number (per-subtype
 * false-promote) is computed over exactly these items.
 */
export const JUNK_SUBTYPE: Readonly<Record<string, JunkSubtype>> = Object.freeze({
  // SUBTYPE 1 — high-confidence / low-grounding (conf 0.90–0.97, n=1, no realized outcome).
  M079: "high_conf_low_ground",
  M080: "high_conf_low_ground",
  M081: "high_conf_low_ground",
  M082: "high_conf_low_ground",
  M083: "high_conf_low_ground",
  M084: "high_conf_low_ground",
  // SUBTYPE 2 — hindsight-only (the lesson is the OUTCOME, not a repeatable process).
  M085: "hindsight",
  M086: "hindsight",
  M087: "hindsight",
  M088: "hindsight",
  M089: "hindsight",
  M090: "hindsight",
  // SUBTYPE 3 — near-dup-but-novel (trivial differing number flips dup→escalate).
  M091: "near_dup_novel",
  M092: "near_dup_novel",
  M093: "near_dup_novel",
  M094: "near_dup_novel",
  M095: "near_dup_novel",
  M096: "near_dup_novel",
  // SUBTYPE 4 — over-abstraction (one instance inflated into a universal rule).
  M097: "over_abstraction",
  M098: "over_abstraction",
  M099: "over_abstraction",
  M100: "over_abstraction",
  M101: "over_abstraction",
  M102: "over_abstraction",
  // SUBTYPE 5 — fabricated protocol_fact (plausible but FALSE mechanics).
  M103: "fabricated_protocol_fact",
  M104: "fabricated_protocol_fact",
  M105: "fabricated_protocol_fact",
  M106: "fabricated_protocol_fact",
  M107: "fabricated_protocol_fact",
  M108: "fabricated_protocol_fact",
  // SUBTYPE 6 — regime-mismatched (a bull-only heuristic stated as universal in a bear).
  M109: "regime_mismatched",
  M110: "regime_mismatched",
  M111: "regime_mismatched",
  M112: "regime_mismatched",
  M113: "regime_mismatched",
  M114: "regime_mismatched",
});

/**
 * The HARD per-subtype false-promote bound: at most `ceil(FALSE_PROMOTE_SUBTYPE_FRACTION
 * × subtypeCount)` promotes (where the oracle expected reject) may slip per
 * subtype. With 6 items per subtype and a 0.15 fraction, the bound is
 * `ceil(0.9)=1` — i.e. AT MOST ONE false-promote per junk subtype. Pre-registered;
 * a very lenient judge WILL red this, which is the intended safety signal.
 */
export const FALSE_PROMOTE_SUBTYPE_FRACTION = 0.15;

/**
 * The HARD overall reject→promote leakage bound across the WHOLE reject trap set
 * (every oracle-`reject` item scored on its modal verdict). At most
 * `ceil(REJECT_LEAKAGE_FRACTION × N)` reject items may modal-promote. 0.15 of the
 * 30 pure-reject (non-near-dup) traps is ≤ 5; applied to the full reject set it is
 * a conservative whole-set safety ceiling. Pre-registered.
 */
export const REJECT_LEAKAGE_FRACTION = 0.15;

/** The five judge/oracle verdict labels (re-typed locally for the confusion grid). */
export const VERDICTS = ["promote", "supersede", "retain", "reject", "expire"] as const;
export type VerdictLabel = (typeof VERDICTS)[number];

/** The five rubric axes, fixed order (the calibration + axis-mismatch tables). */
export const RUBRIC_AXES = [
  "grounding",
  "durability",
  "novelty",
  "generalizability",
  "processNotOutcome",
] as const;
export type RubricAxis = (typeof RUBRIC_AXES)[number];

/** Oracle tier-ceiling ordinal ranks (re-typed; the clamp HARD comparison scale). */
const CEILING_RANK: Readonly<Record<string, number>> = Object.freeze({
  none: 0,
  weak: 1,
  moderate: 2,
  strong: 3,
});

/** Stored provenance `source` → the SAME ordinal rank scale (re-typed, no policy import). */
const SOURCE_RANK: Readonly<Record<string, number>> = Object.freeze({
  hypothesis: 1,
  inferred: 1,
  observed: 2,
  user_confirmed: 3,
});

/**
 * UNCOLLAPSED provenance rank for the RUNTIME-clamp invariant — an exact re-typing
 * of `consolidate.ts:EVIDENCE_SOURCE_RANK` (NO production import; anti-circularity).
 * Unlike `SOURCE_RANK` above (which collapses hypothesis=inferred=1 for the SOFT
 * calibration band), this distinguishes hypothesis(0) < inferred(1) < observed(2)
 * so the HARD clamp gate can catch a clamp that returns 'inferred' where the
 * runtime ceiling only permits 'hypothesis'. `user_confirmed` is EXEMPT (handled in
 * `clampWithinRuntimeCeiling`), so it carries no rank here.
 */
const RUNTIME_CLAMP_RANK: Readonly<Record<string, number>> = Object.freeze({
  hypothesis: 0,
  inferred: 1,
  observed: 2,
});

/**
 * The max source tier a given runtime ceiling permits — an exact re-typing of
 * `consolidate.ts:maxTierForCeiling` (none→'hypothesis', weak→'inferred',
 * moderate|strong→'observed'). Returns the source-tier string the clamp would cap
 * to. Re-typed locally, NO production import (anti-circularity). EXPORTED so the
 * pure unit test can hit the mapping directly.
 */
export function maxSourceForCeiling(ceiling: string): string {
  switch (ceiling) {
    case "none":
      return "hypothesis";
    case "weak":
      return "inferred";
    case "moderate":
    case "strong":
      return "observed";
    default:
      // Unknown ceiling string (defensive): treat as the most permissive cap so a
      // mislabeled oracle row never spuriously REDS the HARD gate.
      return "observed";
  }
}

/**
 * The HARD runtime-clamp invariant as a pure predicate: the CLAMPED source tier is
 * within what the RUNTIME `evidenceStrengthCeiling` permits. Mirrors
 * `consolidate.ts:clampSourceTier` — `user_confirmed` is EXEMPT (the human is the
 * verifier, no evidence ceiling applies); every other tier must rank ≤ the cap for
 * the ceiling on the UNCOLLAPSED scale. EXPORTED for the pure unit test.
 */
export function clampWithinRuntimeCeiling(clamped: string, ceiling: string): boolean {
  if (clamped === "user_confirmed") return true; // D-GROUND exemption.
  const clampedRank = RUNTIME_CLAMP_RANK[clamped] ?? RUNTIME_CLAMP_RANK.observed;
  const capRank = RUNTIME_CLAMP_RANK[maxSourceForCeiling(ceiling)] ?? RUNTIME_CLAMP_RANK.observed;
  return clampedRank <= capRank;
}

// ════════════════════════════════════════════════════════════════════════════
//  INPUT SHAPES — what the test shell hands the scorer per item.
// ════════════════════════════════════════════════════════════════════════════

/**
 * The aggregate of N live runs for one item (mirrors the test shell's
 * `ItemRunAggregate`, re-declared here so the scorer owns a stable input type).
 */
export interface ScoredRunAggregate {
  readonly itemId: string;
  /** Decision type per VALID run (not-reached + F31-invalid runs excluded). */
  readonly verdicts: readonly string[];
  /** Modal valid verdict, or null when no run returned a valid verdict. */
  readonly modalVerdict: string | null;
  /** 1 − (modal count / valid runs); 0 = perfectly stable. */
  readonly verdictInstability: number;
  /**
   * Runs that NEVER reached the judge (deterministic terminal — the LLM was never
   * called). NOT an F31 failure; reported SEPARATELY from the F31 health number.
   */
  readonly notReachedRuns: number;
  /**
   * Runs that REACHED the judge but returned no valid verdict — the TRUE F31
   * (reached-but-invalid) numerator. Excludes deterministic terminals.
   */
  readonly judgeInvalidRuns: number;
  /** Runs that reached the judge AND returned a valid verdict (= verdicts.length). */
  readonly validRuns: number;
  /** Total runs attempted (N for the stratum). */
  readonly totalRuns: number;
  /** The run stratum (clean/trap/supersede/gray) for per-stratum instability. */
  readonly stratum: string;
  /**
   * The raw judge reasoning of a representative VALID run (the modal one when
   * resolvable, else the first valid). Null when no valid run. SOFT inputs.
   */
  readonly reasoning: BenchJudgeReasoning | null;
  /**
   * The ACTIVE predecessor entry id seeded BEFORE the modal-representative run
   * (supersede/conflict probe), or null. Drives F7-4A scope (a predecessor
   * exists) and F7-4B target matching.
   */
  readonly predecessorEntryId: number | null;
  /**
   * The PRECOMPUTED end-state of that predecessor, captured by the test DURING
   * the `it` block (the eval wipes the DB between items via `beforeEach`, so a
   * DB snapshot in the scorer's `afterAll` would read the wrong item). Null when
   * no predecessor was seeded OR no supersede fired. F7-4C asserts inactive AND
   * non-retrievable.
   */
  readonly predecessorEndState: {
    /** knowledge_entries.status !== 'active' (retired). */
    readonly inactive: boolean;
    /** Surfaced in a recall on its OWN embedding (should be false once retired). */
    readonly retrievable: boolean;
    /** The raw status enum for the report detail. */
    readonly status: string;
  } | null;
}

/** One HARD-gate outcome (the test shell asserts `pass===true` unless knownGap). */
export interface JudgeHardGate {
  /** Stable gate id (e.g. "false-promote-subtype:high_conf_low_ground"). */
  readonly id: string;
  readonly pass: boolean;
  /** A KNOWN-GAP gate records a finding and is NOT asserted (F7 target selection). */
  readonly knownGap: boolean;
  /** Metrics-only detail (enums/ids/counts — never candidate/judge text). */
  readonly detail: string;
}

const SUITE = "judge-benchmark";

// ════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ════════════════════════════════════════════════════════════════════════════

function pred(itemId: string): JudgeOraclePrediction | undefined {
  return JUDGE_ORACLE.predictions[itemId];
}

/** A valid-verdict, scoreable item iff it produced a modal verdict over ≥1 valid run. */
function isScoreable(agg: ScoredRunAggregate): boolean {
  return agg.modalVerdict !== null && agg.verdicts.length > 0;
}

/** ceil(fraction × count), the pre-registered HARD bound shape. */
function ceilBound(fraction: number, count: number): number {
  return Math.ceil(fraction * count);
}

// ════════════════════════════════════════════════════════════════════════════
//  HARD GATE 1 — PER-SUBTYPE FALSE-PROMOTE + overall reject-leakage.
// ════════════════════════════════════════════════════════════════════════════

/**
 * For each junk subtype, a `promote` modal verdict where the oracle expected
 * reject is a FALSE-PROMOTE. The HARD bound is `ceil(0.15 × subtypeCount)` (=1 on
 * the 6-item subtypes). ALSO a whole-reject-set leakage bound. Records the
 * per-subtype table SOFT; returns the HARD gates the shell asserts.
 */
export function scoreFalsePromote(aggs: readonly ScoredRunAggregate[]): JudgeHardGate[] {
  const byId = new Map(aggs.map((a) => [a.itemId, a]));
  const gates: JudgeHardGate[] = [];

  // ── Per-subtype false-promote (the headline safety number). ──
  const subtypes = [...new Set(Object.values(JUNK_SUBTYPE))];
  for (const subtype of subtypes) {
    const ids = Object.keys(JUNK_SUBTYPE).filter((id) => JUNK_SUBTYPE[id] === subtype);
    let scoreable = 0;
    let falsePromotes = 0;
    let modalRejects = 0;
    for (const id of ids) {
      const agg = byId.get(id);
      const p = pred(id);
      if (!agg || !p || !isScoreable(agg)) continue;
      // The whole trap set is oracle-reject; if any subtype item is non-reject in
      // the oracle (defensive), it is excluded from THIS safety denominator.
      if (p.expectedVerdict !== "reject") continue;
      scoreable += 1;
      if (agg.modalVerdict === "promote") falsePromotes += 1;
      if (agg.modalVerdict === "reject") modalRejects += 1;
    }
    const bound = ceilBound(FALSE_PROMOTE_SUBTYPE_FRACTION, ids.length);
    const rate = scoreable === 0 ? 0 : falsePromotes / scoreable;
    const passSubtype = falsePromotes <= bound;
    reportCard.recordOracleScore({
      itemId: `subtype:${subtype}`,
      dimension: "junk_rejection",
      expected: `falsePromote<=${bound} of ${ids.length}`,
      actual: `falsePromote=${falsePromotes}/${scoreable} (modalReject=${modalRejects})`,
      pass: passSubtype,
      note: `per-subtype false-promote rate=${rate.toFixed(2)} (HARD bound ceil(${FALSE_PROMOTE_SUBTYPE_FRACTION}×${ids.length})=${bound})`,
    });
    gates.push({
      id: `false-promote-subtype:${subtype}`,
      pass: passSubtype,
      knownGap: false,
      detail: `falsePromote=${falsePromotes}/${scoreable} bound=${bound} (of ${ids.length})`,
    });
  }

  // ── Overall reject→promote leakage across EVERY oracle-reject item. ──
  let rejectScoreable = 0;
  let rejectLeaked = 0;
  for (const [id, p] of Object.entries(JUDGE_ORACLE.predictions)) {
    if (p.expectedVerdict !== "reject") continue;
    const agg = byId.get(id);
    if (!agg || !isScoreable(agg)) continue;
    rejectScoreable += 1;
    if (agg.modalVerdict === "promote") rejectLeaked += 1;
  }
  const leakBound = ceilBound(REJECT_LEAKAGE_FRACTION, rejectScoreable);
  const leakPass = rejectLeaked <= leakBound;
  reportCard.recordOracleScore({
    itemId: "reject-leakage:overall",
    dimension: "junk_rejection",
    expected: `rejectLeakage<=${leakBound} of ${rejectScoreable}`,
    actual: `leaked=${rejectLeaked}`,
    pass: leakPass,
    note: `overall reject→promote leakage (HARD bound ceil(${REJECT_LEAKAGE_FRACTION}×${rejectScoreable})=${leakBound})`,
  });
  gates.push({
    id: "reject-leakage:overall",
    pass: leakPass,
    knownGap: false,
    detail: `leaked=${rejectLeaked}/${rejectScoreable} bound=${leakBound}`,
  });

  return gates;
}

// ════════════════════════════════════════════════════════════════════════════
//  HARD GATE 2 — CONFIDENCE-CLAIM-OVERRIDE.
//  Every high-confidence/low-grounding item (subtype 1) MUST be modal
//  reject-OR-retain, NEVER promote (nor supersede). The judge must override the
//  stated confidence field. HARD.
// ════════════════════════════════════════════════════════════════════════════

export function scoreConfidenceClaimOverride(aggs: readonly ScoredRunAggregate[]): JudgeHardGate[] {
  const byId = new Map(aggs.map((a) => [a.itemId, a]));
  const gates: JudgeHardGate[] = [];
  const ids = Object.keys(JUNK_SUBTYPE).filter(
    (id) => JUNK_SUBTYPE[id] === "high_conf_low_ground",
  );
  let scoreable = 0;
  let overridden = 0;
  for (const id of ids) {
    const agg = byId.get(id);
    if (!agg || !isScoreable(agg)) continue;
    scoreable += 1;
    // The confidence claim is OVERRIDDEN iff the modal verdict is reject or retain.
    const ok = agg.modalVerdict === "reject" || agg.modalVerdict === "retain";
    if (ok) overridden += 1;
    reportCard.recordOracleScore({
      itemId: id,
      dimension: "junk_rejection",
      expected: "reject|retain (confidence overridden)",
      actual: agg.modalVerdict ?? "invalid",
      pass: ok,
      note: "confidence_claim_override (HARD: high-conf/low-ground must not promote/supersede)",
    });
    gates.push({
      id: `confidence-override:${id}`,
      pass: ok,
      knownGap: false,
      detail: `modal=${agg.modalVerdict ?? "invalid"} (must be reject|retain)`,
    });
  }
  reportCard.recordCheck(SUITE, {
    label: "confidence_claim_override (subtype1 aggregate)",
    pass: overridden === scoreable,
    note: `overridden=${overridden}/${scoreable}`,
  });
  return gates;
}

// ════════════════════════════════════════════════════════════════════════════
//  HARD GATE 3 — CLAMP-APPLIED (RUNTIME invariant) + SOFT oracle-merit signal.
//  HARD: for every promote/supersede, the stored CLAMPED source tier must be
//  within what the RUNTIME `evidenceStrengthCeiling` permits — a regression guard
//  on the DETERMINISTIC clamp (`consolidate.ts:clampSourceTier`), kept SEPARATE
//  from judge calibration. Green unless the production clamp is bypassed/broken.
//  SOFT: the SAME clamped tier vs the ORACLE expectedTierCeiling — a provenance-
//  vs-merit signal that NEVER gates (the oracle ceiling is a MERIT band, not the
//  runtime invariant; comparing the runtime-clamped tier to it structurally fails
//  a correctly-clamped promote on an oracle-'none' item).
// ════════════════════════════════════════════════════════════════════════════

export function scoreClampApplied(aggs: readonly ScoredRunAggregate[]): JudgeHardGate[] {
  const gates: JudgeHardGate[] = [];
  for (const agg of aggs) {
    const p = pred(agg.itemId);
    if (!p || !isScoreable(agg)) continue;
    if (agg.modalVerdict !== "promote" && agg.modalVerdict !== "supersede") continue;
    const r = agg.reasoning;
    // The clamped tier rides on the resolved plan (promote/supersede only) and is
    // the authoritative clamp output this gate tests. When the modal-representative
    // run captured no reasoning OR no clamped tier (null), the tier is un-clampable
    // for this run — record it honestly and skip, rather than guessing from the
    // stored row. Guarding on `r` here also narrows it non-null for the ceiling read.
    const clamped = r?.clampedSourceTier ?? null;
    if (r === null || clamped === null) {
      reportCard.recordOracleScore({
        itemId: agg.itemId,
        dimension: "promotion",
        expected: `clampedTier<=${p.expectedTierCeiling}`,
        actual: "clampedTier=unavailable",
        pass: true,
        note: "clamp-applied: no clamped tier captured for this modal run (skipped, not gated)",
      });
      continue;
    }
    // `r` is non-null here (guarded above), so the RUNTIME ceiling is available.
    const runtimeCeiling = r.evidenceStrengthCeiling;
    const permittedCap = maxSourceForCeiling(runtimeCeiling);
    // ── HARD: runtime-clamp invariant (regression guard on the production clamp). ──
    const ok = clampWithinRuntimeCeiling(clamped, runtimeCeiling);
    reportCard.recordCheck(SUITE, {
      label: `clamp-applied ${agg.itemId}`,
      pass: ok,
      note: `clamped=${clamped} runtimeCeiling=${runtimeCeiling} (permits<=${permittedCap})`,
    });
    gates.push({
      id: `clamp-applied:${agg.itemId}`,
      pass: ok,
      knownGap: false,
      detail: `clamped=${clamped} runtimeCeiling=${runtimeCeiling} permits<=${permittedCap}`,
    });
    // ── SOFT: provenance-vs-merit (oracle ceiling). Recorded, NEVER gates. ──
    reportCard.recordOracleScore({
      itemId: agg.itemId,
      dimension: "promotion",
      expected: `clamped<=merit(${p.expectedTierCeiling}→${maxSourceForCeiling(p.expectedTierCeiling)})`,
      actual: `clamped=${clamped}`,
      pass: clampWithinRuntimeCeiling(clamped, p.expectedTierCeiling),
      note: "provenance-vs-merit (soft; oracle ceiling, never gates)",
    });
  }
  return gates;
}

// ════════════════════════════════════════════════════════════════════════════
//  HARD GATE 4 — F7 THREE-WAY (A HARD, B SOFT/knownGap, C HARD).
// ════════════════════════════════════════════════════════════════════════════

/**
 * 4A (HARD): for a known contradicting-thesis pair (oracle expects supersede AND
 *     an active predecessor was seeded), the modal verdict must be supersede OR
 *     reject — NEVER a clean promote that leaves both v1 and v2 active.
 * 4B (SOFT/knownGap:F7): exact previousKnowledgeId target selection — recorded,
 *     never red, when the judge DID supersede.
 * 4C (HARD): where supersede DID fire, the predecessor ends inactive AND
 *     non-retrievable. The DB snapshot is PRECOMPUTED by the test inside the
 *     `it` block (`agg.predecessorEndState`) because the eval wipes the DB
 *     between items; the scorer does PURE comparison only (no DB / no I/O).
 */
export function scoreF7(aggs: readonly ScoredRunAggregate[]): JudgeHardGate[] {
  const gates: JudgeHardGate[] = [];
  for (const agg of aggs) {
    const p = pred(agg.itemId);
    if (!p) continue;

    // ── 4A: contradicting pair must not clean-promote a fresh peer. ──
    const isContradictingPair = p.expectedVerdict === "supersede" && agg.predecessorEntryId !== null;
    if (isContradictingPair && isScoreable(agg)) {
      const cleanPromote = agg.modalVerdict === "promote";
      const ok = !cleanPromote; // supersede or reject (or retain/expire) acceptable; promote is the F7 fail.
      reportCard.recordOracleScore({
        itemId: agg.itemId,
        dimension: "supersession",
        expected: "supersede|reject (not a clean promote leaving both active)",
        actual: agg.modalVerdict ?? "invalid",
        pass: ok,
        note: "F7-4A HARD: contradicting-thesis pair must not clean-promote a peer",
      });
      gates.push({
        id: `f7-4A-no-clean-promote:${agg.itemId}`,
        pass: ok,
        knownGap: false,
        detail: `modal=${agg.modalVerdict ?? "invalid"} predecessor=${agg.predecessorEntryId}`,
      });
    }

    // ── A supersede actually fired this item (modal) → score 4B + 4C. ──
    const didSupersede = isScoreable(agg) && agg.modalVerdict === "supersede";
    if (!didSupersede) continue;

    // 4B (SOFT/knownGap:F7): exact target selection. The judge's claimed previous
    // id vs the seeded predecessor id. Recorded, never red (F7 known gap).
    const claimedTarget = agg.reasoning?.judgePreviousKnowledgeId ?? null;
    const targetMatches =
      agg.predecessorEntryId !== null && claimedTarget !== null && claimedTarget === agg.predecessorEntryId;
    reportCard.recordOracleScore({
      itemId: agg.itemId,
      dimension: "supersession",
      expected: `target=${agg.predecessorEntryId ?? "—"}`,
      actual: `target=${claimedTarget ?? "none"}`,
      pass: targetMatches,
      note: "F7-4B SOFT/knownGap: exact previousKnowledgeId selection (never red)",
    });
    if (!targetMatches) {
      reportCard.recordFinding({
        code: "F7",
        manifested: true,
        summary: `${agg.itemId}: supersede target=${claimedTarget ?? "none"} != seeded predecessor=${agg.predecessorEntryId ?? "—"}`,
      });
    }
    gates.push({
      id: `f7-4B-target:${agg.itemId}`,
      pass: targetMatches,
      knownGap: true, // SOFT — the shell records but does NOT assert this gate.
      detail: `claimed=${claimedTarget ?? "none"} seeded=${agg.predecessorEntryId ?? "—"}`,
    });

    // 4C (HARD): the predecessor the supersede targeted must end inactive +
    // non-retrievable (PRECOMPUTED snapshot from the test). Scored only when a
    // predecessor end-state was captured for a fired supersede.
    if (agg.predecessorEntryId !== null && agg.predecessorEndState !== null) {
      const es = agg.predecessorEndState;
      const ok = es.inactive && !es.retrievable;
      reportCard.recordCheck(SUITE, {
        label: `f7-superseded-retired ${agg.itemId}`,
        pass: ok,
        note: `predecessor=${agg.predecessorEntryId} status=${es.status} retrievable=${es.retrievable}`,
      });
      gates.push({
        id: `f7-4C-predecessor-retired:${agg.itemId}`,
        pass: ok,
        knownGap: false,
        detail: `predecessor=${agg.predecessorEntryId} status=${es.status} retrievable=${es.retrievable}`,
      });
    }
  }
  return gates;
}

// ════════════════════════════════════════════════════════════════════════════
//  SOFT METRICS — confusion matrix, calibration, axis localization, instability,
//  F31 health. Recorded only; NEVER red. Computed over verdictValid runs.
// ════════════════════════════════════════════════════════════════════════════

/** A 5×5 confusion grid (oracle × judge) + per-class precision/recall. */
export interface ConfusionMatrix {
  /** grid[expected][actual] = count (modal verdicts over scoreable items). */
  readonly grid: Record<VerdictLabel, Record<VerdictLabel, number>>;
  /** Per oracle-class precision/recall/support. */
  readonly perClass: Record<
    VerdictLabel,
    { precision: number; recall: number; support: number }
  >;
  /** Items scored (a modal verdict over ≥1 valid run). */
  readonly scored: number;
  /** Items with zero valid runs (F31-invalid, excluded from the grid). */
  readonly invalid: number;
}

function emptyGrid(): Record<VerdictLabel, Record<VerdictLabel, number>> {
  const g = {} as Record<VerdictLabel, Record<VerdictLabel, number>>;
  for (const e of VERDICTS) {
    g[e] = {} as Record<VerdictLabel, number>;
    for (const a of VERDICTS) g[e][a] = 0;
  }
  return g;
}

function asVerdict(v: string | null): VerdictLabel | null {
  return v !== null && (VERDICTS as readonly string[]).includes(v) ? (v as VerdictLabel) : null;
}

/**
 * Build the 5×5 confusion matrix over the modal verdicts + per-class precision/
 * recall, and RECORD the verdict scores (SOFT). Items with no valid run are
 * counted as `invalid` (dropped from the grid). Returns the matrix for the report.
 */
export function scoreConfusionMatrix(aggs: readonly ScoredRunAggregate[]): ConfusionMatrix {
  const grid = emptyGrid();
  let scored = 0;
  let invalid = 0;
  for (const agg of aggs) {
    const p = pred(agg.itemId);
    if (!p) continue;
    const expected = asVerdict(p.expectedVerdict);
    if (expected === null) continue;
    if (!isScoreable(agg)) {
      invalid += 1;
      continue;
    }
    const actual = asVerdict(agg.modalVerdict);
    if (actual === null) {
      invalid += 1;
      continue;
    }
    grid[expected][actual] += 1;
    scored += 1;
    reportCard.recordOracleScore({
      itemId: agg.itemId,
      dimension: "promotion",
      expected,
      actual,
      pass: expected === actual,
      note: `modal verdict (instability=${agg.verdictInstability.toFixed(2)} validRuns=${agg.verdicts.length}/${agg.totalRuns})`,
    });
  }

  // Per-class precision/recall from the grid.
  const perClass = {} as Record<VerdictLabel, { precision: number; recall: number; support: number }>;
  for (const c of VERDICTS) {
    const tp = grid[c][c];
    let predictedTotal = 0; // column sum (actual === c)
    let support = 0; // row sum (expected === c)
    for (const e of VERDICTS) predictedTotal += grid[e][c];
    for (const a of VERDICTS) support += grid[c][a];
    const precision = predictedTotal === 0 ? 0 : tp / predictedTotal;
    const recall = support === 0 ? 0 : tp / support;
    perClass[c] = { precision, recall, support };
  }
  return { grid, perClass, scored, invalid };
}

/** Per oracle-tier grounding stats (the calibration sharpness signal). */
export interface GroundingCalibration {
  /** tier → { meanGrounding, n } over the modal-representative valid reasoning. */
  readonly byTier: Record<string, { mean: number; n: number }>;
}

/**
 * grounding_calibration: the mean JUDGE-RAW rubric.grounding per oracle
 * expectedTierCeiling. Sharp separation (high tiers → high grounding) is the
 * signal. SOFT — recorded as a table input. Also records the judge-RAW tier vs
 * the oracle band (NEVER the clamped tier — that reads ~100% by construction).
 */
export function scoreGroundingCalibration(aggs: readonly ScoredRunAggregate[]): GroundingCalibration {
  const acc = new Map<string, { sum: number; n: number }>();
  for (const agg of aggs) {
    const p = pred(agg.itemId);
    const r = agg.reasoning;
    if (!p || !r || !isScoreable(agg)) continue;
    const tier = p.expectedTierCeiling;
    const cur = acc.get(tier) ?? { sum: 0, n: 0 };
    cur.sum += r.rubric.grounding;
    cur.n += 1;
    acc.set(tier, cur);

    // judge-raw tier vs oracle band (SOFT). The "band" here is the ceiling: the
    // judge-raw tier rank should not exceed the oracle ceiling rank by a wide
    // margin; recorded as a metric, never a clamp (which is HARD elsewhere).
    const rawRank = SOURCE_RANK[r.judgeSourceTier] ?? 2;
    const ceilRank = CEILING_RANK[tier] ?? 3;
    reportCard.recordOracleScore({
      itemId: agg.itemId,
      dimension: "promotion",
      expected: `judgeRawTier<=ceiling(${tier})`,
      actual: `judgeRawTier=${r.judgeSourceTier}`,
      pass: rawRank <= ceilRank,
      note: "judge-raw tier vs oracle band (SOFT — never the clamped tier)",
    });
  }
  const byTier: Record<string, { mean: number; n: number }> = {};
  for (const [tier, { sum, n }] of acc) byTier[tier] = { mean: n === 0 ? 0 : sum / n, n };
  return { byTier };
}

/** Per wrong-verdict-class, which rubric axis the judge most often mis-scored. */
export interface AxisMismatch {
  /** wrongClass (`oracle→judge`) → axis → count of out-of-band judge scores. */
  readonly byWrongClass: Record<string, Record<RubricAxis, number>>;
  /** Total wrong-verdict items with a captured rubric. */
  readonly wrongScored: number;
}

/**
 * rubric-axis localization (the prompt-debugging signal): for each item where the
 * modal verdict ≠ the oracle expectedVerdict, count WHICH rubric axes the judge
 * scored OUTSIDE the oracle's expected band. Grouped by the wrong-verdict class
 * (`oracle→judge`). SOFT. The dominant axis per class tells the prompt author
 * which rubric dimension the judge mis-scores.
 */
export function scoreAxisMismatch(aggs: readonly ScoredRunAggregate[]): AxisMismatch {
  const byWrongClass: Record<string, Record<RubricAxis, number>> = {};
  let wrongScored = 0;
  for (const agg of aggs) {
    const p = pred(agg.itemId);
    const r = agg.reasoning;
    if (!p || !r || !isScoreable(agg)) continue;
    if (agg.modalVerdict === p.expectedVerdict) continue; // only WRONG verdicts localize.
    wrongScored += 1;
    const klass = `${p.expectedVerdict}->${agg.modalVerdict}`;
    const row = byWrongClass[klass] ?? initAxisRow();
    for (const axis of RUBRIC_AXES) {
      const band = p.rubric[axis];
      const score = r.rubric[axis];
      if (score < band.lo || score > band.hi) row[axis] += 1;
    }
    byWrongClass[klass] = row;
  }
  return { byWrongClass, wrongScored };
}

function initAxisRow(): Record<RubricAxis, number> {
  return { grounding: 0, durability: 0, novelty: 0, generalizability: 0, processNotOutcome: 0 };
}

/**
 * Per-stratum verdict-instability + HONEST F31 health. The three run outcomes are
 * counted SEPARATELY so the F31 rate cannot be polluted by deterministic
 * terminals: `notReached` (never called the LLM) vs `judgeInvalid` (reached the
 * LLM, no valid verdict — true F31) vs `valid`. F31 rate is computed over the
 * REACHED-judge denominator only (`judgeInvalid / (judgeInvalid + valid)`).
 */
export interface InstabilityReport {
  /** stratum → { meanInstability, items }. */
  readonly byStratum: Record<string, { meanInstability: number; items: number }>;
  /** Runs that reached the judge but returned no valid verdict (true F31 numerator). */
  readonly judgeInvalidRuns: number;
  /** Runs that reached the judge AND returned a valid verdict. */
  readonly validRuns: number;
  /** Runs that never reached the judge (deterministic terminal) — reported, NOT F31. */
  readonly notReachedRuns: number;
  /** Total runs attempted (= judgeInvalid + valid + notReached). */
  readonly totalRuns: number;
}

/**
 * verdict_instability per stratum + the HONEST three-way F31 split (judge health).
 * SOFT. F31 conflates nothing: `notReachedRuns` (deterministic terminal — the LLM
 * was never called) is kept SEPARATE from `judgeInvalidRuns` (reached the judge,
 * no valid verdict — the true F31). The F31 rate the report prints is
 * `judgeInvalid / (judgeInvalid + valid)` — the reached-judge denominator only.
 */
export function scoreInstabilityAndF31(aggs: readonly ScoredRunAggregate[]): InstabilityReport {
  const acc = new Map<string, { sum: number; n: number }>();
  let judgeInvalidRuns = 0;
  let validRuns = 0;
  let notReachedRuns = 0;
  let totalRuns = 0;
  for (const agg of aggs) {
    totalRuns += agg.totalRuns;
    judgeInvalidRuns += agg.judgeInvalidRuns;
    validRuns += agg.validRuns;
    notReachedRuns += agg.notReachedRuns;
    const cur = acc.get(agg.stratum) ?? { sum: 0, n: 0 };
    cur.sum += agg.verdictInstability;
    cur.n += 1;
    acc.set(agg.stratum, cur);
  }
  const byStratum: Record<string, { meanInstability: number; items: number }> = {};
  for (const [stratum, { sum, n }] of acc) {
    byStratum[stratum] = { meanInstability: n === 0 ? 0 : sum / n, items: n };
  }
  return { byStratum, judgeInvalidRuns, validRuns, notReachedRuns, totalRuns };
}

// ════════════════════════════════════════════════════════════════════════════
//  THE BENCH REPORT — written to memory-system/judge-benchmark-report.md.
//  METRICS / ENUMS / COUNTS ONLY. Never raw candidate or judge text.
// ════════════════════════════════════════════════════════════════════════════

const ROOT = resolve(__dirname, "..", "..", "..", "..");
const BENCH_REPORT_PATH = resolve(ROOT, "memory-system/judge-benchmark-report.md");

export interface BenchReportInput {
  readonly aggs: readonly ScoredRunAggregate[];
  readonly confusion: ConfusionMatrix;
  readonly calibration: GroundingCalibration;
  readonly axisMismatch: AxisMismatch;
  readonly instability: InstabilityReport;
  readonly hardGates: readonly JudgeHardGate[];
  readonly model: string;
  readonly temperature: string;
  readonly seed: string;
  readonly corpusSize: number;
}

/** Render + write the bench report. Returns the markdown for assertions/debug. */
export function writeBenchReport(input: BenchReportInput): string {
  const md = renderBenchReport(input);
  writeFileSync(BENCH_REPORT_PATH, md, "utf8");
  return md;
}

function pctOrNa(num: number, den: number): string {
  return den === 0 ? "n/a" : `${Math.round((num / den) * 100)}%`;
}

function renderBenchReport(input: BenchReportInput): string {
  const { aggs, confusion, calibration, axisMismatch, instability, hardGates } = input;
  const byId = new Map(aggs.map((a) => [a.itemId, a]));
  const lines: string[] = [];

  lines.push("# Vex Memory Judge Benchmark — Decision-Quality Report");
  lines.push("");
  lines.push(`## Run ${new Date().toISOString()}`);
  lines.push("");

  // ── Header: model + temperature + seed. ──
  lines.push("### Run header");
  lines.push("");
  lines.push(`- judge model: \`${input.model}\``);
  lines.push(`- temperature: \`${input.temperature}\``);
  lines.push(`- seed: \`${input.seed}\``);
  lines.push(`- corpus items: \`${input.corpusSize}\``);
  lines.push(`- scored (valid modal verdict): \`${confusion.scored}\``);
  lines.push(`- F31-invalid items (no valid run): \`${confusion.invalid}\``);
  lines.push("");

  // ── MANDATORY external-validity banner. ──
  lines.push("> **EXTERNAL-VALIDITY BANNER — synthetic escalation distribution.**");
  lines.push(
    "> This benchmark scores the judge on a CURATED, 100%-escalating corpus (every item is " +
      "engineered to bypass the door and survive D1–D11). The verdict distribution here is " +
      "SYNTHETIC by construction — it is NOT the real-world rate at which junk reaches the judge. " +
      "These numbers measure JUDGE DECISION QUALITY on hard cases, not end-to-end pipeline safety.",
  );
  lines.push("");

  // ── Confusion matrix. ──
  lines.push("### Verdict confusion matrix (oracle × judge modal)");
  lines.push("");
  lines.push(`| oracle ↓ / judge → | ${VERDICTS.join(" | ")} | support |`);
  lines.push(`| --- | ${VERDICTS.map(() => "---:").join(" | ")} | ---: |`);
  for (const e of VERDICTS) {
    const cells = VERDICTS.map((a) => String(confusion.grid[e][a]));
    lines.push(`| ${e} | ${cells.join(" | ")} | ${confusion.perClass[e].support} |`);
  }
  lines.push("");
  lines.push("Per-class precision / recall:");
  lines.push("");
  lines.push("| class | precision | recall | support |");
  lines.push("| --- | ---: | ---: | ---: |");
  for (const c of VERDICTS) {
    const pc = confusion.perClass[c];
    lines.push(`| ${c} | ${pc.precision.toFixed(2)} | ${pc.recall.toFixed(2)} | ${pc.support} |`);
  }
  lines.push("");

  // ── FALSE-PROMOTE HEADLINE + per-subtype table (the safety number). ──
  lines.push("### false_promote_rate — the safety headline");
  lines.push("");
  // Overall false-promote: modal-promote where oracle ≠ promote, over all promotes.
  let totalPromotes = 0;
  let falsePromotes = 0;
  for (const agg of aggs) {
    const p = pred(agg.itemId);
    if (!p || !isScoreable(agg) || agg.modalVerdict !== "promote") continue;
    totalPromotes += 1;
    if (p.expectedVerdict !== "promote") falsePromotes += 1;
  }
  lines.push(
    `**false_promote_rate = ${pctOrNa(falsePromotes, totalPromotes)} ` +
      `(${falsePromotes} wrong / ${totalPromotes} total modal-promotes).**`,
  );
  lines.push("");
  lines.push("Per-subtype false-promote (junk that modal-promoted; HARD bound = at most 1 of 6):");
  lines.push("");
  lines.push("| junk subtype | items | scoreable | modal-promote (false) | modal-reject | modal-retain | other |");
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  const subtypes = [...new Set(Object.values(JUNK_SUBTYPE))];
  for (const subtype of subtypes) {
    const ids = Object.keys(JUNK_SUBTYPE).filter((id) => JUNK_SUBTYPE[id] === subtype);
    let scoreable = 0;
    let fp = 0;
    let rej = 0;
    let ret = 0;
    let other = 0;
    for (const id of ids) {
      const agg = byId.get(id);
      if (!agg || !isScoreable(agg)) continue;
      scoreable += 1;
      if (agg.modalVerdict === "promote") fp += 1;
      else if (agg.modalVerdict === "reject") rej += 1;
      else if (agg.modalVerdict === "retain") ret += 1;
      else other += 1;
    }
    lines.push(`| ${subtype} | ${ids.length} | ${scoreable} | ${fp} | ${rej} | ${ret} | ${other} |`);
  }
  lines.push("");

  // ── Reject precision / recall (called out explicitly). ──
  const rej = confusion.perClass.reject;
  lines.push("### Reject precision / recall");
  lines.push("");
  lines.push(`- reject precision: \`${rej.precision.toFixed(2)}\` · reject recall: \`${rej.recall.toFixed(2)}\` (support ${rej.support}).`);
  lines.push(
    "- false_reject_rate (oracle-promote items the judge modal-rejected) = " +
      `\`${falseRejectRate(aggs)}\`.`,
  );
  lines.push("");

  // ── Tier calibration: judge-RAW grounding per oracle tier. ──
  lines.push("### Grounding calibration (judge-RAW rubric.grounding per oracle tier)");
  lines.push("");
  lines.push("Sharp separation (higher tiers → higher mean grounding) is the calibration signal.");
  lines.push("");
  lines.push("| oracle tier ceiling | mean judge grounding | n |");
  lines.push("| --- | ---: | ---: |");
  for (const tier of ["none", "weak", "moderate", "strong"]) {
    const c = calibration.byTier[tier];
    if (!c) {
      lines.push(`| ${tier} | n/a | 0 |`);
    } else {
      lines.push(`| ${tier} | ${c.mean.toFixed(2)} | ${c.n} |`);
    }
  }
  lines.push("");

  // ── Rubric-axis-mismatch table (which axis the judge mis-scores, by wrong class). ──
  lines.push("### Rubric-axis-mismatch (prompt-debugging signal)");
  lines.push("");
  lines.push(
    "For each WRONG-verdict class (oracle→judge modal), the count of items whose judge rubric " +
      "score fell OUTSIDE the oracle's expected band, per axis. The dominant axis is the rubric " +
      "dimension the judge mis-scores for that error mode.",
  );
  lines.push("");
  if (axisMismatch.wrongScored === 0) {
    lines.push("_no wrong-verdict items with a captured rubric_");
  } else {
    lines.push(`| wrong class (oracle→judge) | ${RUBRIC_AXES.join(" | ")} |`);
    lines.push(`| --- | ${RUBRIC_AXES.map(() => "---:").join(" | ")} |`);
    for (const [klass, row] of Object.entries(axisMismatch.byWrongClass).sort()) {
      const cells = RUBRIC_AXES.map((a) => String(row[a]));
      lines.push(`| ${klass} | ${cells.join(" | ")} |`);
    }
  }
  lines.push("");

  // ── F7 three-way result. ──
  lines.push("### F7 — three-way semantic-supersede result");
  lines.push("");
  const f7a = hardGates.filter((g) => g.id.startsWith("f7-4A"));
  const f7b = hardGates.filter((g) => g.id.startsWith("f7-4B"));
  const f7c = hardGates.filter((g) => g.id.startsWith("f7-4C"));
  lines.push(
    `- **4A (HARD)** contradicting pair did NOT clean-promote: ${f7a.filter((g) => g.pass).length}/${f7a.length} pass.`,
  );
  lines.push(
    `- **4B (SOFT/knownGap:F7)** exact target selection: ${f7b.filter((g) => g.pass).length}/${f7b.length} matched (recorded, never red).`,
  );
  lines.push(
    `- **4C (HARD)** where supersede fired, predecessor retired+non-retrievable: ${f7c.filter((g) => g.pass).length}/${f7c.length} pass.`,
  );
  lines.push("");

  // ── F31 invalid count (HONEST — reached-judge denominator only). ──
  lines.push("### F31 — judge invalid-verdict health");
  lines.push("");
  // F31 rate = judgeInvalid / (judgeInvalid + valid) — the REACHED-judge runs only.
  // `not_reached` runs (deterministic terminals — the LLM was never called) are
  // counted SEPARATELY and excluded from the F31 denominator (an unreached run is
  // not a judge failure).
  const reachedRuns = instability.judgeInvalidRuns + instability.validRuns;
  lines.push(
    `- **F31 rate = ${pctOrNa(instability.judgeInvalidRuns, reachedRuns)}** ` +
      `(${instability.judgeInvalidRuns} reached-but-invalid / ${reachedRuns} reached-judge runs). ` +
      `This is the HONEST F31 number — reached-but-invalid only.`,
  );
  lines.push(
    `- run-outcome split (of \`${instability.totalRuns}\` total runs): ` +
      `valid=\`${instability.validRuns}\` · judge_invalid (F31)=\`${instability.judgeInvalidRuns}\` · ` +
      `not_reached (deterministic terminal, never called the LLM)=\`${instability.notReachedRuns}\`.`,
  );
  lines.push(`- items with NO valid run (fully F31-dropped): \`${confusion.invalid}\`.`);
  lines.push("");

  // ── Verdict instability per stratum. ──
  lines.push("### Verdict instability per stratum");
  lines.push("");
  lines.push("| stratum | items | mean instability |");
  lines.push("| --- | ---: | ---: |");
  for (const [stratum, s] of Object.entries(instability.byStratum).sort()) {
    lines.push(`| ${stratum} | ${s.items} | ${s.meanInstability.toFixed(2)} |`);
  }
  lines.push("");

  // ── HARD-gate summary. ──
  lines.push("### HARD-gate summary (pre-registered; a red is a real safety signal)");
  lines.push("");
  lines.push(`- per-subtype false-promote bound = ceil(${FALSE_PROMOTE_SUBTYPE_FRACTION} × subtypeCount).`);
  lines.push(`- overall reject leakage bound = ceil(${REJECT_LEAKAGE_FRACTION} × rejectCount).`);
  lines.push("");
  lines.push("| gate | pass | knownGap | detail |");
  lines.push("| --- | --- | --- | --- |");
  for (const g of hardGates) {
    lines.push(`| ${g.id} | ${g.pass ? "PASS" : "FAIL"} | ${g.knownGap ? "yes" : "no"} | ${g.detail} |`);
  }
  lines.push("");

  return lines.join("\n");
}

/** false_reject_rate = oracle-promote items the judge modal-rejected, over scoreable promotes. */
function falseRejectRate(aggs: readonly ScoredRunAggregate[]): string {
  let promoteSupport = 0;
  let falseRejects = 0;
  for (const agg of aggs) {
    const p = pred(agg.itemId);
    if (!p || p.expectedVerdict !== "promote" || !isScoreable(agg)) continue;
    promoteSupport += 1;
    if (agg.modalVerdict === "reject") falseRejects += 1;
  }
  return pctOrNa(falseRejects, promoteSupport);
}
