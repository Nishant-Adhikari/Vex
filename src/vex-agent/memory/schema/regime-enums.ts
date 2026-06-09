/**
 * Market-regime bounded-vocabulary enums (S6b) — the SINGLE SOURCE OF TRUTH for
 * the closed-enum columns on `regime_snapshots` (`trend_label`, `vol_label`,
 * `confidence`, `source`) AND for the closed lesson-tag vocabulary enforced on
 * `knowledge_entries.regime_tags` (F2 — no more free-form `"bull_microcap"`).
 *
 * LOCKSTEP CONTRACT (rules/20 §4): each `as const` tuple here is mirrored by a
 * named CHECK constraint in `db/migrations/001_initial.sql` (`rs_trend_valid` /
 * `rs_vol_valid` / `rs_confidence_valid` / `rs_source_valid`;
 * `ke_regime_tags_valid` is an ARRAY-CONTAINMENT check, not an IN-list). The
 * drift guard in `__tests__/vex-agent/memory/schema/regime-enums.test.ts`
 * parses the SQL CHECK value lists (with a dedicated containment parser for
 * `ke_regime_tags_valid`) and asserts they equal BOTH these arrays AND the
 * matching `z.enum(...).options`, so SQL and TS can never silently diverge.
 *
 * Doctrine (s6b-plan §0/§1): the regime is TWO independent axes (F1 — a market
 * can be bullish AND volatile at once), `unknown` per axis means
 * "unclear / average / contradictory" and yields ZERO influence from that axis.
 * Confidence is BUCKETED (F4 — never a raw float; LLMs overstate certainty).
 * Everything here is advisory-only (OD-1): regime data influences ONLY
 * decay/reactivation (and rank, indirectly through activation) — never sizing,
 * approval, wallet intent, or execution.
 *
 * Pure module: `as const` tuples + Zod schemas + derived types + the pure
 * `tagAxis` mapping. No DB, no I/O.
 */

import { z } from "zod";

// ── trend_label (axis 1) ────────────────────────────────────────
// `unknown` = signals unclear / contradictory / average — that axis exerts no
// influence on decay (fail-closed neutrality, F1).
export const REGIME_TREND_LABELS = ["bull", "bear", "range", "unknown"] as const;

export const regimeTrendLabelSchema = z.enum(REGIME_TREND_LABELS);
export type RegimeTrendLabel = z.infer<typeof regimeTrendLabelSchema>;

// ── vol_label (axis 2) ──────────────────────────────────────────
export const REGIME_VOL_LABELS = ["high", "low", "unknown"] as const;

export const regimeVolLabelSchema = z.enum(REGIME_VOL_LABELS);
export type RegimeVolLabel = z.infer<typeof regimeVolLabelSchema>;

// ── confidence (F4 buckets) ─────────────────────────────────────
// `low` = snapshot recorded, ZERO influence; `medium` = half-life modulation
// within the hard factor bounds; `high` = modulation + possible reactivation.
export const REGIME_CONFIDENCES = ["low", "medium", "high"] as const;

export const regimeConfidenceSchema = z.enum(REGIME_CONFIDENCES);
export type RegimeConfidence = z.infer<typeof regimeConfidenceSchema>;

/**
 * Total order on the confidence buckets (low < medium < high) for `min()`
 * combinations: the single-source cap (worker, F4) and the two-day dwell
 * corroboration (`effectiveRegime` — both days must independently sustain the
 * level).
 */
export const regimeConfidenceRank: Readonly<Record<RegimeConfidence, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

/** The LOWER of two confidence buckets (per `regimeConfidenceRank`). */
export function minRegimeConfidence(a: RegimeConfidence, b: RegimeConfidence): RegimeConfidence {
  return regimeConfidenceRank[a] <= regimeConfidenceRank[b] ? a : b;
}

// ── source (evidence provenance) ────────────────────────────────
// Deliberately NO 'heuristic' value: a failed gather/classify produces NO
// snapshot (fail-closed) — there is no fallback classifier to attribute.
export const REGIME_SOURCES = ["tavily", "twitter", "hybrid"] as const;

export const regimeSourceSchema = z.enum(REGIME_SOURCES);
export type RegimeSource = z.infer<typeof regimeSourceSchema>;

// ── regime tags (closed lesson vocabulary, F2) ──────────────────
// The SAME vocabulary the worker classifies into, so lesson tags and snapshots
// can never drift apart. Vol tags are AXIS-QUALIFIED (`high_vol`, not `high`)
// because a bare "high" is ambiguous across axes. Deliberately minimal start —
// tune by extension: a new value = edit this tuple + the SQL CHECK + dev DB
// reset (lockstep test fails until all sides agree).
export const REGIME_TAGS = ["bull", "bear", "range", "high_vol", "low_vol"] as const;

export const regimeTagSchema = z.enum(REGIME_TAGS);
export type RegimeTag = z.infer<typeof regimeTagSchema>;

/**
 * The axis a regime tag binds to, with the snapshot-label value it matches.
 * `value` excludes `unknown` by construction — a tag always asserts a concrete
 * regime; only a SNAPSHOT axis can be `unknown`.
 */
export type RegimeTagAxis =
  | { readonly axis: "trend"; readonly value: Exclude<RegimeTrendLabel, "unknown"> }
  | { readonly axis: "vol"; readonly value: Exclude<RegimeVolLabel, "unknown"> };

/**
 * Pure tag → axis/value mapping (`'bull'` → trend/bull, `'high_vol'` → vol/high).
 * Exhaustive over `REGIME_TAGS`, so adding a tag without an axis mapping fails
 * to compile.
 */
export function tagAxis(tag: RegimeTag): RegimeTagAxis {
  switch (tag) {
    case "bull":
      return { axis: "trend", value: "bull" };
    case "bear":
      return { axis: "trend", value: "bear" };
    case "range":
      return { axis: "trend", value: "range" };
    case "high_vol":
      return { axis: "vol", value: "high" };
    case "low_vol":
      return { axis: "vol", value: "low" };
    default: {
      const _exhaustive: never = tag;
      return _exhaustive;
    }
  }
}
