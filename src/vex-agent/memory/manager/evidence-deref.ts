/**
 * Light evidence deref (S4 §9 — a SUBSET; S5 extends). The deterministic stage
 * needs three cheap facts about a candidate's immutable evidence anchors:
 *
 * 1. `derefAnchorExistence` — do the anchored `protocol_executions` rows still
 *    exist, and is any of their sessions soft-deleted (OD-3 = BLOCK)? Uses
 *    `executions.getById` + `isSessionSoftDeleted` (R1#9; `getSession` does not
 *    expose `deleted_at`).
 * 2. `countRecurrence` — distinct execution anchors across the candidate's
 *    recurrence cluster (caller computes the cluster via cosine ≥ threshold;
 *    this counts distinct executions across cluster rows + the candidate itself).
 * 3. `deriveEvidenceStrengthCeiling` — none | weak | moderate. NEVER `strong` in
 *    S4 (the full outcome resolver + point-in-time gating is S5).
 *
 * What S4 does NOT do (deferred to S5): outcome resolution from the ledger,
 * point-in-time / no-lookahead gating, bi-temporal validity. `available_at_
 * decision_time` stays NULL and S4 does not gate on it — probationary lessons
 * are out of hot-context, so there is no lookahead risk in hot-context.
 *
 * IO at the edges: the repo reads (`executions.getById`, `isSessionSoftDeleted`)
 * are injected so the derivation is unit-testable without a DB.
 */

import type { EvidenceRefs } from "@vex-agent/memory/schema/memory-candidate.js";
import type { CandidateEvidenceStrength } from "@vex-agent/memory/schema/memory-candidate-enums.js";
import type { MemoryOutcomeSummary } from "@vex-agent/memory/schema/memory-outcome.js";
import { RECURRENCE_PROMOTE_MIN } from "@vex-agent/engine/memory-manager/policy.js";

// ── Anchor existence (D2/D3) ────────────────────────────────────────

export interface AnchorExistenceResult {
  /** At least one anchored execution still exists. */
  anchorExists: boolean;
  /** An existing anchor's session is soft-deleted (OD-3 → reject). */
  softDeleted: boolean;
  /** Count of distinct existing execution anchors (drives the ceiling). */
  existingExecutionCount: number;
}

/** Injected reads so the deref is testable without the executions/sessions repos. */
export interface AnchorDerefDeps {
  /** Returns the execution's sessionId if it exists, or null if it does not. */
  getExecutionSession: (executionId: number) => Promise<{ sessionId: string | null } | null>;
  /** OD-3 — whether a session is soft-deleted (deleted_at IS NOT NULL). */
  isSessionSoftDeleted: (sessionId: string) => Promise<boolean>;
}

/**
 * Deref the candidate's evidence anchors: existence + OD-3 soft-delete block.
 * Distinct execution ids only (a candidate may anchor the same execution via
 * multiple capture items). Stops scanning sessions once one is soft-deleted
 * (a single soft-deleted anchor blocks the whole candidate).
 */
export async function derefAnchorExistence(
  anchors: EvidenceRefs,
  deps: AnchorDerefDeps,
): Promise<AnchorExistenceResult> {
  const seen = new Set<number>();
  let existingExecutionCount = 0;
  let softDeleted = false;

  for (const anchor of anchors) {
    if (seen.has(anchor.executionId)) continue;
    seen.add(anchor.executionId);
    const exec = await deps.getExecutionSession(anchor.executionId);
    if (!exec) continue; // anchor no longer exists (TRUNCATE/replay safe via FIX-1)
    existingExecutionCount += 1;
    if (exec.sessionId !== null && (await deps.isSessionSoftDeleted(exec.sessionId))) {
      softDeleted = true;
      break;
    }
  }

  return {
    anchorExists: existingExecutionCount > 0,
    softDeleted,
    existingExecutionCount,
  };
}

// ── Recurrence (D7) ─────────────────────────────────────────────────

/**
 * Distinct execution anchors observed across the recurrence cluster. The caller
 * passes the candidate's own anchors PLUS the anchors of each clustered row
 * (similar pending/retained candidates + knowledge entries within cosine of the
 * candidate). Distinct `executionId` across all of them is the recurrence count
 * — n≥2 distinct executions means an independently-repeated observation, the
 * D-REC promote gate for a generalization.
 */
export function countRecurrence(
  candidateAnchors: EvidenceRefs,
  clusterAnchors: readonly EvidenceRefs[],
): number {
  const executions = new Set<number>();
  for (const a of candidateAnchors) executions.add(a.executionId);
  for (const refs of clusterAnchors) {
    for (const a of refs) executions.add(a.executionId);
  }
  return executions.size;
}

// ── Evidence-strength ceiling (D3) ──────────────────────────────────

/**
 * The ceiling on `evidence_strength`. S4 derives none | weak | moderate; S5 adds
 * `strong` ONLY for a trade-family candidate whose ledger-resolved outcome is a
 * CLOSED realized result with `evidenceQuality:'strong'` AND `pointInTimeChecked`
 * (D-STRONG). Mapping:
 *   - trade-family + outcome closed/settled + outcome quality 'strong'
 *     + pointInTimeChecked                        → 'strong'   [S5 ONLY]
 *   - no existing anchor                          → 'none'
 *   - ≥1 existing anchor, recurrence < 2          → 'weak'
 *   - ≥1 existing anchor, recurrence ≥ 2          → 'moderate'
 * An OPEN / unrealized / thin outcome NEVER raises the ceiling above the S4
 * recurrence-based result (max 'moderate'). `outcome`/`isTradeKind` omitted →
 * exact S4 behavior (non-trade kinds are untouched). `softDeleted` is handled
 * upstream (a reject), so it is not re-checked here.
 */
export function deriveEvidenceStrengthCeiling(args: {
  anchorExists: boolean;
  recurrenceCount: number;
  /** S5 — the ledger-resolved outcome (omitted in S4 / non-trade paths). */
  outcome?: MemoryOutcomeSummary | null;
  /** S5 — whether the candidate kind is trade-family (`strong` is trade-only). */
  isTradeKind?: boolean;
}): CandidateEvidenceStrength {
  if (
    args.isTradeKind === true &&
    args.outcome != null &&
    (args.outcome.status === "closed" || args.outcome.status === "settled") &&
    args.outcome.evidenceQuality === "strong" &&
    args.outcome.pointInTimeChecked === true
  ) {
    return "strong";
  }
  if (!args.anchorExists) return "none";
  if (args.recurrenceCount >= RECURRENCE_PROMOTE_MIN) return "moderate";
  return "weak";
}
