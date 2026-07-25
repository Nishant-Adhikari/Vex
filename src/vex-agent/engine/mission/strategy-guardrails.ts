/**
 * Strategy-rewrite GUARDRAILS — pure, dependency-free validation logic for the
 * self-improving mission-strategy loop. No SDK / DB / env here so every rule is
 * unit- and red-team-testable in isolation (mirrors the retrospective-prompt
 * split). The orchestration that calls these lives in the main process
 * (`strategy-rewrite.ts`).
 *
 * This is SAFETY-CRITICAL: the agent trades real money and this loop rewrites
 * its own tactical guidance. Every function here is a fail-closed gate — when in
 * doubt it REJECTS, keeping the prior active version.
 *
 * Guardrails implemented here:
 *   (b) validation gate — size/non-empty/well-formed + red-flag pattern scan
 *   (d) drift bound — size cap + bounded delta from prior + bounded distance
 *       from the human baseline
 *       anti-oscillation — flip-flop detection against recently-adopted versions
 *   (e) prompt-injection sanitization of provider-controlled lesson text
 *   anti-overfit — trades-only input filter + cross-mission recurrence clustering
 *
 * The immutable-core-preserved check ((a)) and the second-LLM safety judge ((1))
 * live next to the prompt/orchestration they need (mission-safety-core.ts and
 * strategy-rewrite.ts respectively).
 */

import {
  ADAPTIVE_SECTION_MAX_CHARS,
  ADAPTIVE_SECTION_MIN_CHARS,
} from "../prompts/mission-adaptive.js";

// ── Tunable bounds (defaults; the orchestrator may override from config) ──

export interface GuardrailConfig {
  /** Min distinct missions a lesson-theme must recur across to be adopted. */
  recurrenceMin: number;
  /** Max content distance (0..1) a revision may sit from the PRIOR active. */
  maxDeltaRatio: number;
  /** Max content distance (0..1) a revision may sit from the human baseline. */
  maxBaselineDistanceRatio: number;
  /** How many recently-adopted versions to scan for flip-flop reverts. */
  flipFlopWindow: number;
}

export const DEFAULT_GUARDRAIL_CONFIG: GuardrailConfig = {
  recurrenceMin: 2,
  maxDeltaRatio: 0.5,
  maxBaselineDistanceRatio: 0.75,
  flipFlopWindow: 3,
};

/** A revision that lands within this distance of an older adopted version is a revert. */
const FLIP_FLOP_EPSILON = 0.12;
/** Jaccard threshold for treating two lesson strings as the same theme. */
const LESSON_CLUSTER_THRESHOLD = 0.5;

// ── (e) Prompt-injection sanitization ────────────────────────────────

/**
 * Neutralise provider-controlled free text (lessons, token symbols, summaries)
 * before it enters the rewriter prompt: drop C0 control chars + DEL (newlines
 * included, so nothing can splice a fake line/field), collapse whitespace, and
 * length-bound. The codepoint loop keeps control bytes out of this source file.
 * The caller additionally renders each value as a JSON-quoted scalar.
 */
export function sanitizeLessonText(value: string, max = 280): string {
  let out = "";
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}

// ── (b) Red-flag pattern scan ────────────────────────────────────────

/**
 * Patterns that signal an attempt to WEAKEN a safety control. A revised adaptive
 * section that matches ANY of these is rejected outright (belt-and-suspenders
 * with the second-LLM safety judge). Labels are human-readable for the audit
 * log. Deliberately broad and fail-closed — a false positive costs one rejected
 * revision (the prior version stays live); a false negative could cost money.
 */
export const RED_FLAG_PATTERNS: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "raise/remove capital cap", re: /\b(rais\w*|increas\w*|lift\w*|remov\w*|ignor\w*|exceed\w*|widen\w*|expand\w*)\b[^.]{0,40}\b(cap|caps|capital|risk budget|position limit|max\w*)\b/i },
  { label: "spend beyond cap", re: /\b(risk|spend|deploy|allocat\w*|bet)\b[^.]{0,30}\b(more than|beyond|over)\b[^.]{0,20}(\$|cap|budget|limit)/i },
  { label: "no cap", re: /\b(no|without|unlimited|remove the)\b[^.]{0,20}\b(cap|limit|max|ceiling)\b/i },
  { label: "disable/loosen stop-loss", re: /\b(disabl\w*|remov\w*|skip\w*|ignor\w*|loosen\w*|widen\w*|lift\w*|no|without)\b[^.]{0,40}\bstop[- ]?loss\b/i },
  { label: "skip sellability/honeypot gate", re: /\b(skip\w*|bypass\w*|ignor\w*|disabl\w*|without|no need|avoid\w*|forgo)\b[^.]{0,40}\b(sellab\w*|honeypot|honey-pot|sell[- ]?back|sell route|fee[- ]?on[- ]?transfer)\b/i },
  { label: "skip token check", re: /\b(skip\w*|bypass\w*|ignor\w*|disabl\w*|without)\b[^.]{0,25}\b(check|verif\w*|gate)\b/i },
  { label: "widen wallet scope", re: /\b(vault|secondary|other|another|different|second)\b[^.]{0,20}\bwallet\b|\bwallet\b[^.]{0,20}\b(0x384c|other|any)\b/i },
  { label: "add leverage/margin", re: /\b(leverage|margin|borrow\w*|perps?|futures|short\b)\b/i },
  { label: "ignore deadline", re: /\b(ignor\w*|extend\w*|remov\w*|no|without|past the|beyond the)\b[^.]{0,20}\bdeadline\b/i },
  { label: "ignore token budget", re: /\b(ignor\w*|unlimited|remov\w*|no|without|exceed\w*)\b[^.]{0,20}\b(token budget|budget)\b|\b(token budget|budget)\b[^.]{0,20}\b(unlimited|ignor\w*|infinite|exceed\w*|no limit)\b/i },
  { label: "override safety core", re: /\b(ignor\w*|overrid\w*|disregard\w*|bypass\w*|disabl\w*|supersed\w*)\b[^.]{0,25}\b(safety|safeguard|core|guardrail|rule)\b/i },
];

/** Return the labels of every red-flag pattern the text matches (empty = clean). */
export function scanRedFlags(text: string): string[] {
  return RED_FLAG_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
}

// ── (b) Size / well-formedness ───────────────────────────────────────

export function withinSizeBounds(text: string): boolean {
  const len = text.trim().length;
  return len >= ADAPTIVE_SECTION_MIN_CHARS && len <= ADAPTIVE_SECTION_MAX_CHARS;
}

/**
 * Structural sanity: non-empty, carries real alphabetic content (not just
 * punctuation/whitespace), and no C0 control chars / DEL leaked through.
 */
export function isWellFormed(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  const letters = (trimmed.match(/[a-z]/gi) ?? []).length;
  if (letters < 20) return false;
  for (const ch of trimmed) {
    const code = ch.codePointAt(0) ?? 0;
    // Allow \n and \t; reject other control bytes + DEL.
    if ((code < 0x20 && code !== 0x0a && code !== 0x09) || code === 0x7f) {
      return false;
    }
  }
  return true;
}

// ── (d) Distance metric + delta / baseline / flip-flop bounds ─────────

function wordSet(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
  return new Set(words);
}

/**
 * Content distance in [0,1] — 1 minus the Jaccard similarity of the two texts'
 * significant-word sets. 0 = identical vocabulary, 1 = fully disjoint. Cheap
 * (set ops, not O(n*m) edit distance) and stable for the delta / baseline / flip-
 * flop bounds. Two empty texts are treated as identical (distance 0).
 */
export function contentDistance(a: string, b: string): number {
  const sa = wordSet(a);
  const sb = wordSet(b);
  if (sa.size === 0 && sb.size === 0) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  const union = sa.size + sb.size - inter;
  if (union === 0) return 0;
  return 1 - inter / union;
}

/** Revised section is within the allowed per-cycle delta from the prior active. */
export function withinDeltaBound(
  prior: string,
  revised: string,
  maxDeltaRatio: number,
): boolean {
  return contentDistance(prior, revised) <= maxDeltaRatio;
}

/** Revised section has not drifted too far from the human baseline seed. */
export function withinBaselineBound(
  baseline: string,
  revised: string,
  maxBaselineDistanceRatio: number,
): boolean {
  return contentDistance(baseline, revised) <= maxBaselineDistanceRatio;
}

/**
 * Flip-flop detection: reject a revision that reverts to a version we adopted
 * and then moved away from within the recent window. `recentAdopted` is
 * newest-first and INCLUDES the current active at index 0 (which is the prior we
 * are revising FROM — matching it is not a flip-flop, it's a no-op handled
 * elsewhere). A near-match to any OLDER entry means we are oscillating back.
 */
export function isFlipFlop(revised: string, recentAdopted: string[]): boolean {
  // Skip index 0 (current active) — only older adopted versions count as reverts.
  for (let i = 1; i < recentAdopted.length; i++) {
    if (contentDistance(revised, recentAdopted[i]!) <= FLIP_FLOP_EPSILON) {
      return true;
    }
  }
  return false;
}

// ── Anti-overfit: trades-only filter + cross-mission recurrence ───────

export interface MissionLessonInput {
  readonly missionRunId: string;
  readonly outcome: string;
  readonly trades: number;
  readonly lessons: readonly string[];
  readonly wentWrong: readonly string[];
}

/** Outcomes that represent a real, finished run (not paused/errored/running). */
const ADOPTABLE_OUTCOMES = new Set([
  "completed",
  "stopped",
  "cancelled",
  "timed_out",
  "failed",
]);

/**
 * A mission's lessons feed the rewriter only when the run ACTUALLY TRADED and
 * finished cleanly (not paused/errored/0-trade). This is the anti-overfit input
 * filter — noise from runs that never opened a position must not rewrite tactics.
 */
export function isAdoptableMission(m: MissionLessonInput): boolean {
  return m.trades > 0 && ADOPTABLE_OUTCOMES.has(m.outcome.toLowerCase());
}

function lessonSignature(lesson: string): Set<string> {
  const stop = new Set([
    "the", "and", "for", "with", "before", "after", "that", "this", "into",
    "your", "you", "any", "not", "should", "when", "than", "always", "never",
    "must", "each", "over", "from", "have", "trade", "trades", "trading",
  ]);
  const words = sanitizeLessonText(lesson, 280)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w));
  return new Set(words);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 1 : inter / union;
}

interface Cluster {
  representative: string;
  signature: Set<string>;
  missions: Set<string>;
}

/**
 * Cluster lessons across missions by theme (token-set Jaccard) and keep only the
 * themes that RECUR across at least `recurrenceMin` DISTINCT trading missions —
 * the anti-overfit gate. A single mission's one-off note can never rewrite the
 * strategy on its own. Returns one deduped representative lesson per adopted
 * theme (the longest seen, as the most descriptive). Order: most-recurring first.
 */
export function clusterRecurringLessons(
  missions: readonly MissionLessonInput[],
  recurrenceMin: number,
): string[] {
  const adoptable = missions.filter(isAdoptableMission);
  const clusters: Cluster[] = [];

  for (const m of adoptable) {
    // A mission contributes each distinct lesson/wentWrong once; recurrence is
    // counted across missions, so a mission repeating a theme still counts once.
    const seenThisMission = new Set<Cluster>();
    const candidates = [...m.lessons, ...m.wentWrong];
    for (const raw of candidates) {
      const lesson = sanitizeLessonText(raw, 280);
      if (lesson.length === 0) continue;
      const sig = lessonSignature(lesson);
      if (sig.size === 0) continue;
      let best: Cluster | null = null;
      let bestSim = 0;
      for (const c of clusters) {
        const sim = jaccard(sig, c.signature);
        if (sim > bestSim) {
          bestSim = sim;
          best = c;
        }
      }
      if (best !== null && bestSim >= LESSON_CLUSTER_THRESHOLD) {
        if (lesson.length > best.representative.length) best.representative = lesson;
        best.missions.add(m.missionRunId);
        seenThisMission.add(best);
      } else {
        const c: Cluster = {
          representative: lesson,
          signature: sig,
          missions: new Set([m.missionRunId]),
        };
        clusters.push(c);
        seenThisMission.add(c);
      }
    }
  }

  return clusters
    .filter((c) => c.missions.size >= recurrenceMin)
    .sort((a, b) => b.missions.size - a.missions.size)
    .map((c) => c.representative);
}

// ── Composite validation gate ────────────────────────────────────────

export interface ValidationInput {
  readonly revised: string;
  readonly prior: string;
  readonly baseline: string;
  readonly recentAdopted: string[];
  readonly config: GuardrailConfig;
}

export interface ValidationResult {
  readonly ok: boolean;
  /** Human-readable reasons the revision was rejected (empty when ok). */
  readonly reasons: string[];
}

/**
 * Run the full DETERMINISTIC gate over a proposed revision (everything except
 * the immutable-core assembly check and the LLM safety judge, which the
 * orchestrator layers on top). Fail-closed: every failing rule is collected so
 * the audit log records exactly why a revision was refused.
 */
export function validateRevision(input: ValidationInput): ValidationResult {
  const reasons: string[] = [];
  const { revised, prior, baseline, recentAdopted, config } = input;

  if (!withinSizeBounds(revised)) {
    reasons.push(
      `size out of bounds (${revised.trim().length} chars; allowed ${ADAPTIVE_SECTION_MIN_CHARS}-${ADAPTIVE_SECTION_MAX_CHARS})`,
    );
  }
  if (!isWellFormed(revised)) {
    reasons.push("not well-formed (empty / control chars / no real content)");
  }
  const flags = scanRedFlags(revised);
  if (flags.length > 0) {
    reasons.push(`red-flag pattern(s): ${flags.join(", ")}`);
  }
  if (!withinDeltaBound(prior, revised, config.maxDeltaRatio)) {
    reasons.push(
      `delta from prior exceeds ${config.maxDeltaRatio} (${contentDistance(prior, revised).toFixed(2)})`,
    );
  }
  if (!withinBaselineBound(baseline, revised, config.maxBaselineDistanceRatio)) {
    reasons.push(
      `distance from baseline exceeds ${config.maxBaselineDistanceRatio} (${contentDistance(baseline, revised).toFixed(2)})`,
    );
  }
  if (isFlipFlop(revised, recentAdopted.slice(0, config.flipFlopWindow + 1))) {
    reasons.push("flip-flop: reverts a recently-superseded version");
  }

  return { ok: reasons.length === 0, reasons };
}
