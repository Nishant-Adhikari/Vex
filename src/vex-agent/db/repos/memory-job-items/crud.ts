/**
 * memory_job_items CRUD — per-candidate reservation + working-state transitions.
 *
 * Concurrency disciplines (S1c spec §5):
 *   - reserveCandidatesForJob: owner-checked (parent running + locked_by), ONE
 *     transaction with TWO steps because two different unique constraints can be
 *     hit and ON CONFLICT arbitrates only one (R2-MF2):
 *       1. revive this job's OWN dormant (released|failed) items — a CTE locks
 *          the candidate rows (FOR UPDATE OF c SKIP LOCKED) FIRST, then updates
 *          only the locked items (R3-MF1: locking c serializes revive vs.
 *          concurrent insert on the same candidate);
 *       2. lock + insert new pending candidates up to the remaining limit
 *          (FOR UPDATE SKIP LOCKED on memory_candidates serializes concurrent
 *          reservers so uniq_mji_active_candidate can never be violated;
 *          ON CONFLICT DO NOTHING is belt-and-suspenders).
 *     Counts are NOT stored (R4-MF2) — progress is derived via getJobProgress.
 *   - markItemProcessing / markItemDone / markItemFailed: owner-checked in ONE
 *     statement (UPDATE … FROM memory_jobs j) so a reclaimed stale worker cannot
 *     mutate items (R2-MF3). `done` REQUIRES a decisionId (mji_done_has_decision
 *     + uniq_mji_decision enforce it at the DB — MF4).
 *   - releaseItemsForJob: system op (reserved|processing → released) used by
 *     recoverStaleRunning (in-txn) and on abandon; NOT owner-checked.
 */

import type { PoolClient } from "pg";

import {
  executeWith,
  getPool,
  queryWith,
  withTransaction,
  type Executor,
} from "../../client.js";
import { memLog } from "@vex-agent/memory/observability/logger.js";
import {
  ITEM_COLUMNS,
  mapRow,
  type MemoryJobItem,
  type MemoryJobItemRow,
  type MemoryJobItemStatus,
} from "./types.js";

/** Run `fn` on the provided tx client, or open a fresh transaction. */
async function inTransaction<T>(
  client: PoolClient | undefined,
  fn: (tx: PoolClient) => Promise<T>,
): Promise<T> {
  return client ? fn(client) : withTransaction(fn);
}

// ── Reserve (owner-checked; revive + lock-and-insert in one txn) ──

/**
 * Reserve up to `limit` candidates for a running job owned by `workerId`.
 * Returns the reserved candidate ids (revived own items + newly inserted). A
 * non-owner / non-running job reserves nothing (MF3). See the module header for
 * the two-step locking discipline (R2-MF2 / R3-MF1).
 */
export async function reserveCandidatesForJob(
  jobId: number,
  workerId: string,
  limit: number,
  client?: PoolClient,
): Promise<string[]> {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const cap = Math.floor(limit);

  return inTransaction(client, async (tx) => {
    // Owner check (MF3): parent job must be running AND locked by this worker.
    // FOR UPDATE pins the job row so it cannot be reclaimed mid-reservation.
    const owner = await tx.query<{ id: number }>(
      `SELECT id FROM memory_jobs
       WHERE id = $1 AND status = 'running' AND locked_by = $2
       FOR UPDATE`,
      [jobId, workerId],
    );
    if (owner.rows.length === 0) return [];

    const reserved: string[] = [];

    // Step 1 (R3-MF1): revive this job's OWN released|failed items, locking the
    // candidate rows first so the UPDATE cannot race into uniq_mji_active_candidate.
    const revive = await tx.query<{ candidate_id: string }>(
      `WITH lockable AS (
         SELECT i.id
         FROM memory_job_items i
         JOIN memory_candidates c ON c.id = i.candidate_id
         WHERE i.job_id = $1
           AND i.item_status IN ('released', 'failed')
           AND NOT EXISTS (
             SELECT 1 FROM memory_job_items a
             WHERE a.candidate_id = i.candidate_id
               AND a.item_status IN ('reserved', 'processing'))
         FOR UPDATE OF c SKIP LOCKED
       )
       UPDATE memory_job_items
       SET item_status = 'reserved', updated_at = NOW()
       WHERE id IN (SELECT id FROM lockable)
       RETURNING candidate_id`,
      [jobId],
    );
    for (const r of revive.rows) reserved.push(r.candidate_id);

    // Step 2: lock + insert new pending candidates up to the remaining limit.
    const remaining = cap - reserved.length;
    if (remaining > 0) {
      const inserted = await tx.query<{ candidate_id: string }>(
        `WITH picked AS (
           SELECT c.id
           FROM memory_candidates c
           WHERE c.status = 'pending'
             AND NOT EXISTS (
               SELECT 1 FROM memory_job_items a
               WHERE a.candidate_id = c.id
                 AND a.item_status IN ('reserved', 'processing'))
             AND NOT EXISTS (
               SELECT 1 FROM memory_job_items b
               WHERE b.job_id = $1 AND b.candidate_id = c.id)
           ORDER BY c.recorded_at ASC
           LIMIT $2
           FOR UPDATE SKIP LOCKED
         )
         INSERT INTO memory_job_items (job_id, candidate_id)
         SELECT $1, id FROM picked
         ON CONFLICT (job_id, candidate_id) DO NOTHING
         RETURNING candidate_id`,
        [jobId, remaining],
      );
      for (const r of inserted.rows) reserved.push(r.candidate_id);
    }

    memLog("job_item", "reserved", { jobId, count: reserved.length });
    return reserved;
  });
}

// ── Working-state transitions (all owner-checked, single statement) ──

/**
 * Transition a reserved item to `processing`. Owner-checked via a join to the
 * parent job (running + locked_by). Returns true iff transitioned.
 */
export async function markItemProcessing(
  itemId: number,
  jobId: number,
  workerId: string,
  client?: PoolClient,
): Promise<boolean> {
  const exec: Executor = client ?? getPool();
  const rowCount = await executeWith(
    exec,
    `UPDATE memory_job_items i
       SET item_status = 'processing', updated_at = NOW()
     FROM memory_jobs j
     WHERE i.id = $1 AND i.job_id = $2 AND j.id = i.job_id
       AND j.status = 'running' AND j.locked_by = $3
       AND i.item_status = 'reserved'`,
    [itemId, jobId, workerId],
  );
  return rowCount === 1;
}

/**
 * Transition a reserved|processing item to `done`, linking its decision.
 * Owner-checked. `decisionId` (the BIGINT memory_decisions.id) is REQUIRED —
 * mji_done_has_decision + uniq_mji_decision enforce it at the DB (MF4). The
 * linked decision MUST be this item's OWN: a join to memory_decisions requires
 * the decision's job_id + candidate_id to match the item and to be a
 * consolidation decision (reconcile_entry_id IS NULL), so an item can never be
 * closed with another candidate's (or a reconcile) decision. Returns true iff
 * transitioned.
 */
export async function markItemDone(
  itemId: number,
  jobId: number,
  workerId: string,
  decisionId: string,
  client?: PoolClient,
): Promise<boolean> {
  if (!decisionId) {
    throw new Error("markItemDone: decisionId is required (an item cannot be 'done' without a decision).");
  }
  const exec: Executor = client ?? getPool();
  const rowCount = await executeWith(
    exec,
    `UPDATE memory_job_items i
       SET item_status = 'done', decision_id = $4, updated_at = NOW()
     FROM memory_jobs j, memory_decisions d
     WHERE i.id = $1 AND i.job_id = $2 AND j.id = i.job_id
       AND j.status = 'running' AND j.locked_by = $3
       AND i.item_status IN ('reserved', 'processing')
       AND d.id = $4 AND d.job_id = i.job_id AND d.candidate_id = i.candidate_id
       AND d.reconcile_entry_id IS NULL`,
    [itemId, jobId, workerId, decisionId],
  );
  const ok = rowCount === 1;
  if (ok) memLog("job_item", "done", { jobId });
  return ok;
}

/**
 * Transition a reserved|processing item to `failed`. Owner-checked. `errorCode`
 * is a BOUNDED code (never a raw message) stored in `last_error`. The candidate
 * re-enters the pool (failed is a revivable state — MF2). Returns true iff
 * transitioned.
 */
export async function markItemFailed(
  itemId: number,
  jobId: number,
  workerId: string,
  errorCode: string,
  client?: PoolClient,
): Promise<boolean> {
  const exec: Executor = client ?? getPool();
  const rowCount = await executeWith(
    exec,
    `UPDATE memory_job_items i
       SET item_status = 'failed', last_error = $4, updated_at = NOW()
     FROM memory_jobs j
     WHERE i.id = $1 AND i.job_id = $2 AND j.id = i.job_id
       AND j.status = 'running' AND j.locked_by = $3
       AND i.item_status IN ('reserved', 'processing')`,
    [itemId, jobId, workerId, errorCode],
  );
  const ok = rowCount === 1;
  if (ok) memLog("job_item", "failed", { jobId, errorCode });
  return ok;
}

/**
 * Release this job's active (reserved|processing) items back to `released`,
 * re-entering their candidates into the pool. System op (recoverStaleRunning
 * in-txn / on abandon) — NOT owner-checked. Returns the number released.
 */
export async function releaseItemsForJob(
  jobId: number,
  client?: PoolClient,
): Promise<number> {
  const exec: Executor = client ?? getPool();
  return executeWith(
    exec,
    `UPDATE memory_job_items
       SET item_status = 'released', updated_at = NOW()
     WHERE job_id = $1 AND item_status IN ('reserved', 'processing')`,
    [jobId],
  );
}

// ── Reads ────────────────────────────────────────────────────────

/**
 * List a job's items (optionally filtered by `status`), id ascending
 * (reservation order). Inspection / worker bookkeeping.
 */
export async function listItemsByJob(
  jobId: number,
  status?: MemoryJobItemStatus,
  client?: PoolClient,
): Promise<MemoryJobItem[]> {
  const exec: Executor = client ?? getPool();
  const rows =
    status === undefined
      ? await queryWith<MemoryJobItemRow>(
          exec,
          `SELECT ${ITEM_COLUMNS} FROM memory_job_items
            WHERE job_id = $1 ORDER BY id ASC`,
          [jobId],
        )
      : await queryWith<MemoryJobItemRow>(
          exec,
          `SELECT ${ITEM_COLUMNS} FROM memory_job_items
            WHERE job_id = $1 AND item_status = $2 ORDER BY id ASC`,
          [jobId, status],
        );
  return rows.map(mapRow);
}
