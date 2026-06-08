/**
 * memory_decisions repo — types + row mapper + column list.
 *
 * Append-only audit of every manager decision EVENT (one immutable row per
 * decision; `decision_version` orders re-decisions). The three identity refs
 * (candidate_id, reconcile_entry_id, job_id) are immutable ANCHOR columns with
 * NO FK (R2-MF1) — the log survives deletion of its subject. Only the knowledge
 * OUTCOME pointers (promoted/supersedes/merge_target) are live FKs (SET NULL).
 *
 * `id` is BIGSERIAL, returned by the pg driver as a string (int8) — kept as
 * `string` in the domain (precision-safe). `evidenceRefs` is the FIX-1 immutable
 * anchor snapshot (EvidenceRefs from memory-candidate.ts).
 */

import type { EvidenceRefs } from "@vex-agent/memory/schema/memory-candidate.js";
import type {
  MemoryDecisionActor,
  MemoryDecisionRejectReason,
  MemoryDecisionType,
} from "@vex-agent/memory/schema/memory-decision-enums.js";

export type {
  MemoryDecisionActor,
  MemoryDecisionRejectReason,
  MemoryDecisionType,
} from "@vex-agent/memory/schema/memory-decision-enums.js";

// ── Pg row shape (snake_case) ───────────────────────────────────
export interface MemoryDecisionRow {
  id: string; // pg bigint → string
  candidate_id: string | null;
  reconcile_entry_id: number | null;
  job_id: number;
  decision_version: number;
  decision_type: string;
  decision_hash: string;
  reject_reason: string | null;
  promoted_knowledge_id: number | null;
  supersedes_knowledge_id: number | null;
  merge_target_knowledge_id: number | null;
  outcome_version: number | null;
  evidence_refs: EvidenceRefs | null;
  inference_provider: string | null;
  inference_model: string | null;
  cost_usd: string | null; // pg numeric → string
  decided_by: string;
  decided_at: string;
  created_at: string;
}

export interface MemoryDecisionRowWithInsertFlag extends MemoryDecisionRow {
  inserted: boolean;
}

// ── Domain shape (camelCase) ────────────────────────────────────
export interface MemoryDecision {
  id: string;
  /** Candidate anchor (no FK); null for reconcile decisions. */
  candidateId: string | null;
  /** Reconcile anchor (no FK); set for reconcile decisions. */
  reconcileEntryId: number | null;
  /** Job anchor (no FK); every decision traces to a job. */
  jobId: number;
  decisionVersion: number;
  decisionType: MemoryDecisionType;
  decisionHash: string;
  rejectReason: MemoryDecisionRejectReason | null;
  promotedKnowledgeId: number | null;
  supersedesKnowledgeId: number | null;
  mergeTargetKnowledgeId: number | null;
  /** S7 reconcile linkage (knowledge_entries.outcome_version); null for candidate decisions. */
  outcomeVersion: number | null;
  /** FIX-1 immutable evidence anchor snapshot. */
  evidenceRefs: EvidenceRefs;
  inferenceProvider: string | null;
  inferenceModel: string | null;
  costUsd: number | null;
  decidedBy: MemoryDecisionActor;
  decidedAt: string;
  createdAt: string;
}

export function mapRow(r: MemoryDecisionRow): MemoryDecision {
  return {
    id: r.id,
    candidateId: r.candidate_id,
    reconcileEntryId: r.reconcile_entry_id,
    jobId: r.job_id,
    decisionVersion: r.decision_version,
    decisionType: r.decision_type as MemoryDecisionType,
    decisionHash: r.decision_hash,
    rejectReason: r.reject_reason as MemoryDecisionRejectReason | null,
    promotedKnowledgeId: r.promoted_knowledge_id,
    supersedesKnowledgeId: r.supersedes_knowledge_id,
    mergeTargetKnowledgeId: r.merge_target_knowledge_id,
    outcomeVersion: r.outcome_version,
    evidenceRefs: r.evidence_refs ?? [],
    inferenceProvider: r.inference_provider,
    inferenceModel: r.inference_model,
    costUsd: r.cost_usd === null ? null : Number.parseFloat(r.cost_usd),
    decidedBy: r.decided_by as MemoryDecisionActor,
    decidedAt: r.decided_at,
    createdAt: r.created_at,
  };
}

// ── Column list (single source of truth for reads) ──────────────
export const DECISION_COLUMNS = `
  id, candidate_id, reconcile_entry_id, job_id,
  decision_version, decision_type, decision_hash, reject_reason,
  promoted_knowledge_id, supersedes_knowledge_id, merge_target_knowledge_id,
  outcome_version, evidence_refs,
  inference_provider, inference_model, cost_usd,
  decided_by, decided_at, created_at
`;
