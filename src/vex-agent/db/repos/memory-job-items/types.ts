/**
 * memory_job_items repo — types + row mapper + column list.
 *
 * Per-candidate reservation + working state for a batch memory_job. The
 * reservation guard `uniq_mji_active_candidate` (a candidate is actively held by
 * at most one job) is the batch concurrency primitive; `decision_id` links a
 * `done` item to its immutable memory_decisions row (mji_done_has_decision +
 * uniq_mji_decision).
 *
 * `decisionId` is the BIGINT memory_decisions.id, which the pg driver returns as
 * a string (int8) — kept as `string` in the domain (precision-safe) to match the
 * decisions repo's `MemoryDecision.id`.
 */

import type { MemoryJobItemStatus } from "@vex-agent/memory/schema/memory-job-enums.js";

export type { MemoryJobItemStatus } from "@vex-agent/memory/schema/memory-job-enums.js";

// ── Pg row shape (snake_case) ───────────────────────────────────
export interface MemoryJobItemRow {
  id: number;
  job_id: number;
  candidate_id: string;
  item_status: string;
  decision_id: string | null; // pg bigint → string
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

// ── Domain shape (camelCase) ────────────────────────────────────
export interface MemoryJobItem {
  id: number;
  jobId: number;
  candidateId: string;
  itemStatus: MemoryJobItemStatus;
  /** memory_decisions.id (BIGINT → string) once the item is `done`, else null. */
  decisionId: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export function mapRow(r: MemoryJobItemRow): MemoryJobItem {
  return {
    id: r.id,
    jobId: r.job_id,
    candidateId: r.candidate_id,
    itemStatus: r.item_status as MemoryJobItemStatus,
    decisionId: r.decision_id,
    lastError: r.last_error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Column list (single source of truth for reads) ──────────────
export const ITEM_COLUMNS = `
  id, job_id, candidate_id, item_status, decision_id, last_error,
  created_at, updated_at
`;
