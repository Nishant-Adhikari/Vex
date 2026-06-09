/**
 * LLM-judge verdict schema (S4 §7). The judge is consulted for EVERY promotion
 * (Fork C): a deterministic stage may cheaply terminal-reject / expire / retain,
 * but NOTHING promotes without the judge.
 *
 * Output layer EXCLUDES `merge` (D-MERGE): in S4 the judge emits exactly five
 * verdicts — `promote | supersede | retain | reject | expire`. `merge`
 * (enrich-in-place) is DEFERRED to a later refinement stage. This exclusion is
 * at the JUDGE-OUTPUT layer only — the substrate `decision_type` /
 * `recordDecisionInputSchema` enum is NOT narrowed (S1c locked; `merge` stays
 * reserved). The verdict→decision mapping in `judge.ts` only ever produces the
 * five S4 decision types.
 *
 * The rubric is FIVE separate axes scored 1–5 (anchored + few-shot in
 * `judge-prompt.ts`), kept SEPARATE so calibration can de-weight one without
 * collapsing the others. `sourceTier` is the AUTHORITATIVE manager-derived
 * provenance tier (§6, D-GROUND) — the manager NEVER trusts the agent's claim.
 *
 * Pure module: Zod schema + derived types. No DB, no I/O.
 */

import { z } from "zod";

import { knowledgeSourceSchema } from "@vex-agent/memory/long-memory-source-policy.js";
import { memoryDecisionRejectReasonSchema } from "@vex-agent/memory/schema/memory-decision-enums.js";

/** The five S4 verdict labels the judge may emit (NO `merge`). */
export const JUDGE_VERDICTS = [
  "promote",
  "supersede",
  "retain",
  "reject",
  "expire",
] as const;

export const judgeVerdictTypeSchema = z.enum(JUDGE_VERDICTS);
export type JudgeVerdictType = z.infer<typeof judgeVerdictTypeSchema>;

/** A 1–5 anchored rubric score. */
const rubricScore = z.number().int().min(1).max(5);

/**
 * The judge's structured rubric (§7). Five SEPARATE axes:
 * - grounding: how well the claim is anchored in dereferenceable evidence.
 * - durability: how long the lesson stays true (vs transient / regime-bound).
 * - novelty: non-redundancy vs existing knowledge.
 * - generalizability: applies beyond the single instance.
 * - processNotOutcome: the lesson is about the PROCESS (pre-decision signals),
 *   not the realized OUTCOME (PnL hindsight). Only meaningful for the trade
 *   family; the judge sets it to 3 (neutral) for non-trade kinds.
 */
export const judgeRubricSchema = z
  .object({
    grounding: rubricScore,
    durability: rubricScore,
    novelty: rubricScore,
    generalizability: rubricScore,
    processNotOutcome: rubricScore,
  })
  .strict();

export type JudgeRubric = z.infer<typeof judgeRubricSchema>;

/**
 * The full judge verdict. `sourceTier` is the manager-derived provenance tier
 * (REUSES the knowledge-source vocabulary). `previousKnowledgeId` is REQUIRED iff
 * the verdict is `supersede` (the predecessor to replace) — a refine enforces it.
 * `rejectReason` is REQUIRED iff the verdict is `reject` or `expire`. `regimeTags`
 * are bounded market-regime labels carried onto the promoted entry.
 */
export const judgeVerdictSchema = z
  .object({
    verdict: judgeVerdictTypeSchema,
    rubric: judgeRubricSchema,
    sourceTier: knowledgeSourceSchema,
    regimeTags: z.array(z.string().min(1).max(64)).max(16).optional().default([]),
    previousKnowledgeId: z.number().int().positive().optional(),
    rejectReason: memoryDecisionRejectReasonSchema.optional(),
  })
  .strict()
  .refine(
    (v) => v.verdict !== "supersede" || v.previousKnowledgeId !== undefined,
    { message: "supersede requires previousKnowledgeId", path: ["previousKnowledgeId"] },
  )
  .refine(
    (v) => (v.verdict !== "reject" && v.verdict !== "expire") || v.rejectReason !== undefined,
    { message: "reject/expire requires rejectReason", path: ["rejectReason"] },
  );

export type JudgeVerdict = z.infer<typeof judgeVerdictSchema>;
