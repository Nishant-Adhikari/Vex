/**
 * LLM-judge prompt builders (S4 §7). The judge sees ONLY redacted, bounded
 * context — the redacted candidate + a redacted transcript window + the
 * deterministic signals. NEVER raw evidence values, secrets, or live state.
 *
 * The system prompt carries the anchored 1–5 rubric (five SEPARATE axes) + the
 * hard calibration rules + few-shot exemplars + the strict-JSON output contract.
 * The user prompt carries the candidate + signals + transcript.
 *
 * Pure module: string builders only. No DB, no I/O.
 */

import type { JudgeContext } from "./context-builder.js";

const RUBRIC = [
  "Score each axis 1-5 (integers). The five axes are SEPARATE — never let one raise another:",
  "  grounding         1=no dereferenceable evidence trail; 3=an anchor exists; 5=strong, recurring, multi-source evidence.",
  "  durability        1=transient/live-state/regime-bound; 3=holds for a while; 5=a lasting rule.",
  "  novelty           1=duplicate of existing knowledge; 3=a refinement; 5=genuinely new.",
  "  generalizability  1=one-off instance only; 3=applies to a few cases; 5=a broad rule.",
  "  processNotOutcome (trade family only; 3 for non-trade) 1=the lesson is hindsight from realized PnL; 5=it is about pre-decision signals/process.",
].join("\n");

const CALIBRATION = [
  "CALIBRATION (hard rules):",
  "- You MUST NOT set sourceTier above the evidenceStrengthCeiling signal. ceiling 'none' ⇒ at most 'hypothesis'; 'weak' ⇒ at most 'inferred'; 'moderate' ⇒ at most 'observed'. NEVER 'strong'/anything above the ceiling.",
  "- If the transcript shows the USER explicitly affirming a preference/fact (isUserAffirmed), sourceTier = 'user_confirmed' even WITHOUT an anchor.",
  "- Confident phrasing does NOT raise grounding. Only dereferenceable evidence does. You lower/scope, you never inflate.",
  "- A GENERALIZED lesson (isGeneralization) with recurrenceCount < 2 must NOT be promoted — return verdict 'retain'.",
  "- Default-deny ordering: prefer 'retain' or 'reject' before 'promote'. When uncertain but clean, 'retain' (it stays recallable, nothing is lost).",
].join("\n");

const VERDICT_RULES = [
  "Choose ONE verdict:",
  "  promote   grounding>=3 AND durability>=3 AND novelty>=3 AND generalizability>=3 AND (non-trade OR processNotOutcome>=3) AND (if generalization, recurrenceCount>=2).",
  "  supersede a conflictFlag is set, this is newer+stronger than the conflicting entry: set previousKnowledgeId to the conflicting knowledge id.",
  "  retain    promotable in spirit but recurrenceCount<2 for a generalization, OR generalizability<=2, OR processNotOutcome unresolved.",
  "  reject    grounding=1 -> insufficient_evidence; novelty=1 -> duplicate; processNotOutcome=1 (trade) -> insufficient_evidence; conflict-loser -> superseded_by_existing; live-state -> secret_or_live_state; toxic -> policy. Set rejectReason.",
  "  expire    the candidate is past its TTL. Set rejectReason='expired_ttl'.",
  "Do NOT emit 'merge'.",
].join("\n");

const FEW_SHOT = [
  "EXAMPLES:",
  'Candidate: a strategy_lesson "paid dexscreener boost + buyer dominance + rising m5 volume signals a real chance" with 1 execution anchor, recurrenceCount=1.',
  '=> {"verdict":"retain","rubric":{"grounding":3,"durability":3,"novelty":4,"generalizability":4,"processNotOutcome":4},"sourceTier":"inferred","regimeTags":[]} (single occurrence — a recallable hypothesis, not yet a rule).',
  'Same lesson observed in a SECOND independent trade, recurrenceCount=2, ceiling "moderate".',
  '=> {"verdict":"promote","rubric":{"grounding":3,"durability":3,"novelty":3,"generalizability":4,"processNotOutcome":4},"sourceTier":"observed","regimeTags":["bull_microcap"]}.',
  'Candidate: "token went up" with NO evidence_refs and no thesis.',
  '=> {"verdict":"reject","rubric":{"grounding":1,"durability":1,"novelty":2,"generalizability":1,"processNotOutcome":3},"sourceTier":"hypothesis","rejectReason":"insufficient_evidence"}.',
].join("\n");

const OUTPUT_CONTRACT = [
  "Output STRICT JSON only, no prose, this exact shape:",
  '{ "verdict": "promote|supersede|retain|reject|expire", "rubric": { "grounding": <1-5>, "durability": <1-5>, "novelty": <1-5>, "generalizability": <1-5>, "processNotOutcome": <1-5> }, "sourceTier": "observed|user_confirmed|inferred|hypothesis", "regimeTags": [..], "previousKnowledgeId": <int, supersede only>, "rejectReason": "<reject/expire only>" }',
].join("\n");

export function buildJudgeSystemPrompt(): string {
  return [
    "You are the memory CURATOR for an autonomous crypto agent. You decide whether a PROPOSED memory candidate becomes durable long-term knowledge. Memory is ADVISORY only — it never controls execution, sizing, or approvals.",
    "You receive a REDACTED candidate, a REDACTED transcript window, and deterministic signals. You never see secrets or live values.",
    RUBRIC,
    CALIBRATION,
    VERDICT_RULES,
    FEW_SHOT,
    OUTPUT_CONTRACT,
  ].join("\n\n");
}

export function buildJudgeUserPrompt(ctx: JudgeContext): string {
  const signals = ctx.signals;
  const nearDup = signals.nearDupTopK
    .slice(0, 5)
    .map((m) => `  - knowledgeId=${m.knowledgeId} kind=${m.kind} similarity=${m.similarity.toFixed(3)}`)
    .join("\n");

  return [
    `CANDIDATE (redacted):`,
    `  kind: ${ctx.candidate.kind}`,
    `  title: ${ctx.candidate.title}`,
    `  summary: ${ctx.candidate.summary}`,
    ctx.candidate.contentMd ? `  content:\n${indent(ctx.candidate.contentMd)}` : "",
    `  importance: ${ctx.candidate.importance}`,
    ctx.candidate.confidence !== null ? `  agentConfidence: ${ctx.candidate.confidence}` : "",
    "",
    `SIGNALS (deterministic, authoritative — do not override):`,
    `  evidenceStrengthCeiling: ${signals.evidenceStrengthCeiling}`,
    `  recurrenceCount: ${signals.recurrenceCount}`,
    `  anchorExists: ${signals.anchorExists}`,
    `  isUserAffirmed: ${signals.isUserAffirmed}`,
    `  isGeneralization: ${signals.isGeneralization}`,
    `  conflictFlag: ${signals.conflictFlag}${signals.conflictKnowledgeId !== null ? ` (conflictKnowledgeId=${signals.conflictKnowledgeId})` : ""}`,
    nearDup ? `  nearDuplicates:\n${nearDup}` : "  nearDuplicates: none",
    "",
    `TRANSCRIPT (redacted window):`,
    ctx.transcript || "  (no transcript available)",
    "",
    "Return your verdict as strict JSON.",
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function indent(text: string): string {
  return text
    .split("\n")
    .map((l) => `    ${l}`)
    .join("\n");
}
