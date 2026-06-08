/**
 * Memory v2 — manager work-substrate bounded-vocabulary enums (S1c). The SINGLE
 * SOURCE OF TRUTH for the three bounded-vocab columns on the batch-queue tables:
 * `memory_jobs.job_kind`, `memory_jobs.status`, and `memory_job_items.item_status`.
 *
 * LOCKSTEP CONTRACT (rules/20 §4): each `as const` tuple here is mirrored by a
 * named CHECK constraint in `db/migrations/001_initial.sql` (`mj_job_kind_valid`
 * / `mj_status_valid` / `mji_item_status_valid`). The drift guard in
 * `__tests__/vex-agent/memory/schema/memory-job-enums.test.ts` parses the SQL
 * CHECK value lists and asserts they equal BOTH these arrays AND the matching
 * `z.enum(...).options`, so SQL and TS can never silently diverge.
 *
 * Advisory-only doctrine (memory-system-v2 §6): these are WORKER MECHANICS only
 * (a durable queue + per-candidate reservation). No value here couples memory to
 * sizing / approval / wallet-intent; the forbidden execution-coupling tokens
 * (`execution_constraint`, `sizing_hint`) appear on neither these enums nor any
 * S1c column.
 *
 * Pure module: `as const` tuples + Zod schemas + derived types. No DB, no I/O.
 */

import { z } from "zod";

// ── job_kind ────────────────────────────────────────────────────
// What a memory_job processes. `consolidate` = sweep N pending candidates
// (batch dedup/merge → cheaper LLM, owner choice Q1=B). `reconcile` = re-derive
// a single knowledge_entries lesson after its outcome changed (S7), keyed by
// (reconcile_entry_id, reconcile_outcome_version).
export const MEMORY_JOB_KIND = ["consolidate", "reconcile"] as const;

export const memoryJobKindSchema = z.enum(MEMORY_JOB_KIND);
export type MemoryJobKind = z.infer<typeof memoryJobKindSchema>;

// ── job status ──────────────────────────────────────────────────
// Durable-queue FSM, identical to compact_jobs: `pending → running →
// completed | failed → permanently_failed`. `failed` is the AUTO-RETRY state
// (next_attempt_at backoff); `permanently_failed` is terminal until an explicit
// reset (resetReconcileJob / resetPermanentlyFailed precedent).
export const MEMORY_JOB_STATUS = [
  "pending",
  "running",
  "completed",
  "failed",
  "permanently_failed",
] as const;

export const memoryJobStatusSchema = z.enum(MEMORY_JOB_STATUS);
export type MemoryJobStatus = z.infer<typeof memoryJobStatusSchema>;

// ── job-item status ─────────────────────────────────────────────
// Per-candidate reservation lifecycle inside a batch job. `reserved` and
// `processing` are the ACTIVE states the reservation guard (uniq_mji_active_candidate)
// keys off — a candidate is actively held by at most one job. `done` always
// carries a decision_id (mji_done_has_decision); `failed` / `released` free the
// candidate back into the pool for another reservation (retry revive, MF2/MF3).
export const MEMORY_JOB_ITEM_STATUS = [
  "reserved",
  "processing",
  "done",
  "failed",
  "released",
] as const;

export const memoryJobItemStatusSchema = z.enum(MEMORY_JOB_ITEM_STATUS);
export type MemoryJobItemStatus = z.infer<typeof memoryJobItemStatusSchema>;
