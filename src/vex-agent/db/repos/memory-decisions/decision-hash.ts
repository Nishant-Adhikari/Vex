/**
 * Deterministic semantic hash for a memory_decisions row (MF5).
 *
 * Stored on `memory_decisions.decision_hash` (CHAR(64), hex CHECK). It is the
 * idempotency tiebreaker: a repeat `recordDecision` for the same
 * (candidate, version) / (reconcile_entry, outcome_version) returns the existing
 * row ONLY when its stored hash equals the recomputed one; a DIFFERENT hash for
 * the same version is an `idempotency_conflict` (a different decision for the
 * same version is a bug, never a silent duplicate).
 *
 * Encoding REUSES the length-prefixed SHA256 style of `knowledge/content-hash.ts`
 * (`${len}:${field}|${len}:${field}|…`): unambiguous and deterministic with zero
 * escaping. `evidenceRefs` is canonicalized order-independently (each anchor →
 * fixed-key JSON, the array sorted) so two decisions that differ only in anchor
 * ordering hash the same. Only the SEMANTIC payload is hashed — never timestamps,
 * inference provider/model/cost, or job_id (the same decision reached on a retry
 * by a different job is still the same decision).
 */

import { createHash } from "node:crypto";

import type { EvidenceRefs } from "@vex-agent/memory/schema/memory-candidate.js";

export interface DecisionHashInput {
  /** Which anchor identifies the decision subject. */
  anchorKind: "candidate" | "reconcile";
  /** candidate_id (uuid) for `candidate`, or String(reconcile_entry_id) for `reconcile`. */
  anchorId: string;
  /** decision_version for candidate decisions, outcome_version for reconcile. */
  version: number;
  decisionType: string;
  promotedKnowledgeId: number | null;
  supersedesKnowledgeId: number | null;
  mergeTargetKnowledgeId: number | null;
  rejectReason: string | null;
  evidenceRefs: EvidenceRefs;
}

function canonicalAnchor(a: EvidenceRefs[number]): string {
  // Fixed key order → deterministic per-anchor JSON; nulls fill optional fields.
  return JSON.stringify({
    executionId: a.executionId,
    captureItemId: a.captureItemId ?? null,
    instrumentKey: a.instrumentKey ?? null,
    positionKey: a.positionKey ?? null,
  });
}

export function computeDecisionHash(input: DecisionHashInput): string {
  const evidence = input.evidenceRefs.map(canonicalAnchor).sort().join("");
  const lp = (s: string): string => `${s.length}:${s}`;
  const encoded = [
    lp(input.anchorKind),
    lp(input.anchorId),
    lp(String(input.version)),
    lp(input.decisionType),
    lp(input.promotedKnowledgeId === null ? "" : String(input.promotedKnowledgeId)),
    lp(input.supersedesKnowledgeId === null ? "" : String(input.supersedesKnowledgeId)),
    lp(input.mergeTargetKnowledgeId === null ? "" : String(input.mergeTargetKnowledgeId)),
    lp(input.rejectReason ?? ""),
    lp(evidence),
  ].join("|");
  return createHash("sha256").update(encoded).digest("hex");
}
