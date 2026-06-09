/**
 * Promotion boundary (FIX-4, S4 §8). The ONLY write path into `knowledge_entries`
 * is `promote()` / `supersedeFromCandidate()` — both redact + scan-live-state
 * BEFORE any store. The async manager owns this; the agent never writes
 * knowledge directly (FIX-3 — these are internal functions, NOT ToolDefs).
 *
 * `applyDecision` runs INSIDE the per-candidate transaction the orchestrator
 * opens (after the owner-check). It dispatches on the resolved plan:
 *   - promote   → insert a probationary, advisory long-term entry (reuse the
 *                 candidate's content_hash + embedding — NO re-embed), then mark
 *                 the candidate promoted.
 *   - supersede → supersede the conflicting predecessor with a probationary
 *                 successor; mark the candidate promoted (successor IS the
 *                 promotion).
 *   - retain    → candidate → 'retained' (recallable dual-trace; nothing lost).
 *   - reject    → candidate → 'rejected'.
 *   - expire    → candidate → 'expired'.
 * It returns the `recordDecision` input (decisionVersion 0, NO decisionHash /
 * decidedBy — the repo owns those) the caller then records IN THE SAME tx.
 *
 * Defense-in-depth (§8.1): promote re-runs `redact()` + `scanLiveState()` on the
 * already-redacted candidate text. A NEW secret / live-state hit is an anomaly →
 * promotion is refused and the plan becomes a reject(secret_or_live_state).
 */

import type { PoolClient } from "pg";

import {
  insertEntry,
  type InsertEntryInput,
} from "@vex-agent/db/repos/knowledge.js";
import { supersedeEntry } from "@vex-agent/db/repos/knowledge-lifecycle.js";
import {
  getCandidateEmbedding,
  updateCandidateStatus,
  type MemoryCandidate,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { redact } from "@vex-agent/memory/redaction.js";
import { scanLiveState } from "@vex-agent/memory/exclusion-rules.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import type { RecordDecisionInput } from "@vex-agent/memory/schema/memory-decision.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";
import type { MemoryDecisionRejectReason } from "@vex-agent/memory/schema/memory-decision-enums.js";
import type { DecayPolicy } from "@vex-agent/memory/schema/long-memory-enums.js";
import { PROBATION_ACTIVATION } from "@vex-agent/engine/memory-manager/policy.js";
import { isTradeKind } from "./kind-families.js";

// ── Resolved decision plan ─────────────────────────────────────────

export type DecisionPlan =
  | {
      type: "promote";
      sourceTier: KnowledgeSource;
      regimeTags: string[];
      inferenceProvider: string | null;
      inferenceModel: string | null;
      costUsd: number | null;
    }
  | {
      type: "supersede";
      previousKnowledgeId: number;
      sourceTier: KnowledgeSource;
      regimeTags: string[];
      inferenceProvider: string | null;
      inferenceModel: string | null;
      costUsd: number | null;
    }
  | { type: "retain"; inferenceProvider?: string | null; inferenceModel?: string | null; costUsd?: number | null }
  | { type: "reject"; reason: MemoryDecisionRejectReason }
  | { type: "expire"; reason: MemoryDecisionRejectReason };

export interface ApplyDecisionResult {
  /** The recordDecision input to write IN THE SAME tx (decisionVersion 0). */
  decisionInput: RecordDecisionInput;
}

/** Anomaly thrown by `promote` when defense-in-depth redaction is NOT a no-op. */
export class PromoteRedactionAnomalyError extends Error {
  constructor(public readonly candidateId: string) {
    super(`promote: defense-in-depth redaction was not a no-op for candidate ${candidateId}`);
    this.name = "PromoteRedactionAnomalyError";
  }
}

// ── decay policy by kind ────────────────────────────────────────────

function decayPolicyFor(kind: string): DecayPolicy {
  // Trade-family lessons erode with regime/outcome; others do not decay in S4.
  return isTradeKind(kind) ? "regime_aware" : "none";
}

// ── Build the knowledge insert input from a candidate (no re-embed) ──

interface PromotionInsert {
  input: InsertEntryInput;
}

/**
 * Build the `insertEntry` input for a promoted candidate. REUSES the candidate's
 * content_hash + embedding (getCandidateEmbedding — no re-embed) and re-runs the
 * defense-in-depth redaction/live-state scan. THROWS `PromoteRedactionAnomaly-
 * Error` if either is not a no-op.
 *
 * source_refs mapping (R2#1): `knowledge_entries.source_refs` is the DURABLE
 * FIX-1 anchor field. We build it from `candidate.evidenceRefs` (the immutable
 * anchors S7 reconcile derefs) with the transcript pointers nested separately —
 * NEVER a blind pass of `candidate.sourceRefs`.
 */
async function buildPromotionInsert(
  candidate: MemoryCandidate,
  plan: { sourceTier: KnowledgeSource; regimeTags: string[] },
  tx: PoolClient,
): Promise<PromotionInsert> {
  // Defense-in-depth: the candidate text was redacted in S2; a fresh secret /
  // live-state hit means an anomaly upstream — refuse to promote.
  const aggregate = `${candidate.title}\n${candidate.summary}\n${candidate.contentMd}`;
  const r = redact(aggregate);
  if (r.hardRedactCount > 0 || r.maskCount > 0) {
    throw new PromoteRedactionAnomalyError(candidate.id);
  }
  if (scanLiveState(aggregate).rejected) {
    throw new PromoteRedactionAnomalyError(candidate.id);
  }

  const emb = await getCandidateEmbedding(candidate.id, tx);
  if (!emb) {
    throw new Error(`promote: candidate embedding missing for ${candidate.id}`);
  }

  // Reuse the candidate's content_hash (same redacted text + formatter ⇒
  // byte-identical to what S2 stored; idempotent on knowledge.content_hash).
  const contentHash = computeContentHash({
    kind: candidate.kind,
    title: candidate.title,
    summary: candidate.summary,
    contentMd: candidate.contentMd,
  });

  const sourceRefs: Record<string, unknown> = {
    evidence: candidate.evidenceRefs,
    transcript: candidate.sourceRefs,
  };

  const input: InsertEntryInput = {
    kind: candidate.kind,
    title: candidate.title,
    summary: candidate.summary,
    contentMd: candidate.contentMd,
    tags: candidate.tags,
    sourceRefs,
    confidence: candidate.confidence,
    pinned: false,
    validUntil: null,
    contentHash,
    embeddingModel: emb.embeddingModel,
    embeddingDim: emb.embeddingDim,
    embedding: emb.embedding,
    source: plan.sourceTier,
    // ── Memory v2 influence (S4): probationary, de-weighted, advisory-ALWAYS. ──
    maturityState: "probationary",
    activationStrength: PROBATION_ACTIVATION,
    influenceScope: "advisory",
    decayPolicy: decayPolicyFor(candidate.kind),
    regimeTags: plan.regimeTags,
    firstPromotedAt: new Date(),
  };

  return { input };
}

// ── promote() ───────────────────────────────────────────────────────

/**
 * Insert a probationary long-term entry from a promoted candidate (idempotent on
 * content_hash) and mark the candidate `promoted`. Runs in the caller's tx.
 * Returns the `recordDecision` input (decisionVersion 0). THROWS the redaction
 * anomaly if defense-in-depth is not a no-op (the orchestrator converts it to a
 * reject).
 */
export async function promote(
  candidate: MemoryCandidate,
  plan: Extract<DecisionPlan, { type: "promote" }>,
  jobId: number,
  tx: PoolClient,
): Promise<ApplyDecisionResult> {
  const { input } = await buildPromotionInsert(
    candidate,
    { sourceTier: plan.sourceTier, regimeTags: plan.regimeTags },
    tx,
  );
  const { entry } = await insertEntry(input, tx);

  const upd = await updateCandidateStatus(
    candidate.id,
    "promoted",
    { expectedFromStatus: "pending", promotedKnowledgeId: entry.id },
    tx,
  );
  if (!upd.ok) {
    throw new Error(
      `promote: candidate ${candidate.id} status transition failed (${upd.reason})`,
    );
  }

  memLog("promote", "stored", { candidateId: candidate.id, promotedKnowledgeId: entry.id });

  return {
    decisionInput: {
      decisionType: "promote",
      candidateId: candidate.id,
      jobId,
      decisionVersion: 0,
      promotedKnowledgeId: entry.id,
      evidenceRefs: candidate.evidenceRefs,
      ...inferenceFields(plan),
    },
  };
}

// ── supersedeFromCandidate() ────────────────────────────────────────

/**
 * Supersede a conflicting predecessor with a probationary successor built from
 * the candidate, then mark the candidate `promoted` (the successor IS the
 * promotion). Runs in the caller's tx. Returns the recordDecision input carrying
 * BOTH the supersededId (predecessor) and the new successor as promotedKnowledgeId.
 */
export async function supersedeFromCandidate(
  candidate: MemoryCandidate,
  plan: Extract<DecisionPlan, { type: "supersede" }>,
  jobId: number,
  tx: PoolClient,
): Promise<ApplyDecisionResult> {
  const { input } = await buildPromotionInsert(
    candidate,
    { sourceTier: plan.sourceTier, regimeTags: plan.regimeTags },
    tx,
  );

  const result = await supersedeEntry(
    {
      previousId: plan.previousKnowledgeId,
      reason: "superseded_by_candidate",
      kind: input.kind,
      title: input.title,
      summary: input.summary,
      contentMd: input.contentMd,
      tags: input.tags,
      sourceRefs: input.sourceRefs,
      confidence: input.confidence,
      pinned: input.pinned,
      validUntil: input.validUntil,
      contentHash: input.contentHash,
      embeddingModel: input.embeddingModel,
      embeddingDim: input.embeddingDim,
      embedding: input.embedding,
      source: input.source,
      maturityState: input.maturityState,
      activationStrength: input.activationStrength,
      influenceScope: input.influenceScope,
      decayPolicy: input.decayPolicy,
      regimeTags: input.regimeTags,
      firstPromotedAt: input.firstPromotedAt,
    },
    tx,
  );

  const upd = await updateCandidateStatus(
    candidate.id,
    "promoted",
    { expectedFromStatus: "pending", promotedKnowledgeId: result.successor.id },
    tx,
  );
  if (!upd.ok) {
    throw new Error(
      `supersedeFromCandidate: candidate ${candidate.id} status transition failed (${upd.reason})`,
    );
  }

  memLog("promote", "superseded", {
    candidateId: candidate.id,
    promotedKnowledgeId: result.successor.id,
    supersedesKnowledgeId: plan.previousKnowledgeId,
  });

  return {
    decisionInput: {
      decisionType: "supersede",
      candidateId: candidate.id,
      jobId,
      decisionVersion: 0,
      promotedKnowledgeId: result.successor.id,
      supersedesKnowledgeId: plan.previousKnowledgeId,
      evidenceRefs: candidate.evidenceRefs,
      ...inferenceFields(plan),
    },
  };
}

// ── Non-promoting verdicts ──────────────────────────────────────────

/** Build the recordDecision input for a retain/reject/expire + flip the status. */
export async function applyTerminal(
  candidate: MemoryCandidate,
  plan: Extract<DecisionPlan, { type: "retain" | "reject" | "expire" }>,
  jobId: number,
  tx: PoolClient,
): Promise<ApplyDecisionResult> {
  const toStatus = plan.type === "retain" ? "retained" : plan.type === "reject" ? "rejected" : "expired";
  const upd = await updateCandidateStatus(
    candidate.id,
    toStatus,
    { expectedFromStatus: "pending" },
    tx,
  );
  if (!upd.ok) {
    throw new Error(
      `applyTerminal: candidate ${candidate.id} → ${toStatus} failed (${upd.reason})`,
    );
  }

  if (plan.type === "retain") {
    return {
      decisionInput: {
        decisionType: "retain",
        candidateId: candidate.id,
        jobId,
        decisionVersion: 0,
        evidenceRefs: candidate.evidenceRefs,
        ...inferenceFields(plan),
      },
    };
  }
  return {
    decisionInput: {
      decisionType: plan.type, // 'reject' | 'expire'
      candidateId: candidate.id,
      jobId,
      decisionVersion: 0,
      rejectReason: plan.reason,
      evidenceRefs: candidate.evidenceRefs,
    },
  };
}

// ── Dispatch ────────────────────────────────────────────────────────

/**
 * Apply the resolved plan inside the caller's tx. A promote whose defense-in-depth
 * redaction trips is converted to a reject(secret_or_live_state) (never stored).
 * The caller records the returned decision input IN THE SAME tx, then closes the
 * item AFTER commit.
 */
export async function applyDecision(
  candidate: MemoryCandidate,
  plan: DecisionPlan,
  jobId: number,
  tx: PoolClient,
): Promise<ApplyDecisionResult> {
  switch (plan.type) {
    case "promote":
      try {
        return await promote(candidate, plan, jobId, tx);
      } catch (err) {
        if (err instanceof PromoteRedactionAnomalyError) {
          memLog.warn("promote", "redaction_anomaly", { candidateId: candidate.id });
          return applyTerminal(
            candidate,
            { type: "reject", reason: "secret_or_live_state" },
            jobId,
            tx,
          );
        }
        throw err;
      }
    case "supersede":
      return supersedeFromCandidate(candidate, plan, jobId, tx);
    case "retain":
    case "reject":
    case "expire":
      return applyTerminal(candidate, plan, jobId, tx);
    default: {
      const _exhaustive: never = plan;
      return _exhaustive;
    }
  }
}

// ── helpers ─────────────────────────────────────────────────────────

function inferenceFields(plan: {
  inferenceProvider?: string | null;
  inferenceModel?: string | null;
  costUsd?: number | null;
}): {
  inferenceProvider?: string;
  inferenceModel?: string;
  costUsd?: number;
} {
  const out: { inferenceProvider?: string; inferenceModel?: string; costUsd?: number } = {};
  if (plan.inferenceProvider) out.inferenceProvider = plan.inferenceProvider;
  if (plan.inferenceModel) out.inferenceModel = plan.inferenceModel;
  if (plan.costUsd !== null && plan.costUsd !== undefined) out.costUsd = plan.costUsd;
  return out;
}
