/**
 * Knowledge lifecycle repo — transactional supersede for canonical agent memory.
 *
 * PR2 split this from the original monolith into:
 *   - `knowledge-lifecycle/errors.ts` (SupersedeError / SupersedeErrorCode)
 *   - `knowledge-lifecycle/types.ts`  (SupersedeInput / SupersedeResult + row helpers)
 *   - `knowledge-lifecycle/supersede.ts` (runSupersedeStatements — the SQL body)
 *
 * This barrel keeps the original import path (`@echo-agent/db/repos/knowledge-lifecycle.js`)
 * working unchanged: `supersedeEntry` is the public transactional entry
 * point, plus re-exports of the errors and result types used by callers.
 *
 * Contract (`supersedeEntry`):
 *   - Atomic: predecessor lock → validations → INSERT successor → UPDATE predecessor,
 *     all inside one BEGIN/COMMIT. A failure at any step rolls back; the DB never
 *     ends up with a successor row without its predecessor flipped to `superseded`
 *     (or vice versa).
 *   - Single-successor lineage: the partial unique index on `supersedes_id`
 *     enforces "at most one successor per predecessor". We surface a clean
 *     `SupersedeError` well before that constraint fires, via an in-transaction
 *     re-check under the FOR UPDATE lock.
 *   - Content identity check: the new content_hash MUST differ from the
 *     predecessor AND must not collide with any other existing row. If it does,
 *     we reject with `SupersedeError` — NOT a generic unique-violation trace.
 */

import type { PoolClient } from "pg";
import { getPool } from "../client.js";

import { SupersedeError } from "./knowledge-lifecycle/errors.js";
import { runSupersedeStatements } from "./knowledge-lifecycle/supersede.js";
import type {
  SupersedeInput,
  SupersedeResult,
} from "./knowledge-lifecycle/types.js";

export { SupersedeError } from "./knowledge-lifecycle/errors.js";
export type { SupersedeErrorCode } from "./knowledge-lifecycle/errors.js";
export type { SupersedeInput, SupersedeResult } from "./knowledge-lifecycle/types.js";

/**
 * Atomically replace an active predecessor with a new successor entry.
 *
 * Own-tx path (no `client`): opens BEGIN/COMMIT; ROLLBACK on any error.
 * External-tx path (caller passes `client`): runs statements in-place
 * under the caller's transaction — e.g. `withLeaseSharedLock` hands us
 * a `PoolClient` that already holds the maintenance-lease SHARE lock,
 * and we layer the supersede logic on top without nesting transactions.
 *
 * Throws `SupersedeError` for business rejections (stable `code`);
 * rethrows unexpected pg errors as-is. The external-tx caller owns the
 * rollback in that mode.
 */
export async function supersedeEntry(
  input: SupersedeInput,
  client?: PoolClient,
): Promise<SupersedeResult> {
  if (input.embedding.length !== input.embeddingDim) {
    throw new Error(
      `supersedeEntry: embedding length ${input.embedding.length} does not match embeddingDim ${input.embeddingDim} ` +
        `(content_hash=${input.contentHash}). The DB CHECK constraint would reject this.`,
    );
  }
  if (!Number.isFinite(input.previousId) || input.previousId <= 0) {
    throw new SupersedeError(
      "predecessor_not_found",
      input.previousId,
      `invalid previous_id: ${input.previousId}`,
    );
  }

  if (client) {
    // Caller owns the transaction (e.g. via `withLeaseSharedLock`). We run
    // the statements in-place; any throw propagates to the caller who is
    // responsible for the ROLLBACK.
    return runSupersedeStatements(client, input);
  }

  const pool = getPool();
  const own = await pool.connect();
  try {
    await own.query("BEGIN");
    const result = await runSupersedeStatements(own, input);
    await own.query("COMMIT");
    return result;
  } catch (err) {
    await own.query("ROLLBACK").catch(() => {
      // ROLLBACK failures are non-actionable; the original error is what matters.
    });
    throw err;
  } finally {
    own.release();
  }
}
