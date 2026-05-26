/**
 * Integration: `resetPermanentlyFailed` — the user-triggered compaction retry
 * transition (stage 8-5). Split from `compact-jobs.int.test.ts` to keep each
 * file under the 400-line budget.
 *
 * Proofs requiring a live DB:
 *   - A `permanently_failed` row is re-enqueued to `pending` with EVERY
 *     terminal/progress/audit field cleared, so it looks like a fresh job.
 *   - The reset job is immediately claimable (attempt_count 0 → 1).
 *   - `not_found` for a missing id; `not_permanently_failed` for a non-terminal
 *     row (left unchanged).
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  enqueueJob,
  claimNextDueJob,
  getById,
  resetPermanentlyFailed,
  type NewCompactJob,
} from "@vex-agent/db/repos/compact-jobs/index.js";
import { execute } from "@vex-agent/db/client.js";
import { makeSession, resetDb } from "../setup/fixtures.js";

function newJob(sessionId: string, gen: number): NewCompactJob {
  return {
    sessionId,
    checkpointGeneration: gen,
    agentSummary: `Summary for generation ${gen}`,
    preserveMd: null,
    threadThemesHints: [],
    sourceStartMessageId: null,
    sourceEndMessageId: 100,
  };
}

/** Stamp a fully terminal row: permanently_failed WITH progress/audit set, as
 *  a partial run that then exhausted retries would leave it. */
async function makePermanentlyFailed(
  sessionId: string,
  gen: number,
): Promise<number> {
  const enq = await enqueueJob(newJob(sessionId, gen));
  await execute(
    `UPDATE compact_jobs
       SET status='permanently_failed', attempt_count=max_attempts,
           last_error='exhausted', completed_at=NOW(), started_at=NOW(),
           inference_completed_at=NOW(), inference_provider='openrouter',
           inference_model='m', cost_usd=0.5,
           chunks_inserted=2, chunks_rejected_by_exclusion=1,
           chunks_rejected_by_redaction=1
       WHERE id=$1`,
    [enq.job.id],
  );
  return enq.job.id;
}

describe("resetPermanentlyFailed (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("re-enqueues a permanently_failed job and clears all terminal/progress/audit fields", async () => {
    const sid = await makeSession();
    const id = await makePermanentlyFailed(sid, 1);

    const r = await resetPermanentlyFailed(id);
    expect(r.ok).toBe(true);

    const after = await getById(id);
    expect(after?.status).toBe("pending");
    expect(after?.attemptCount).toBe(0);
    expect(after?.lastError).toBeNull();
    expect(after?.startedAt).toBeNull();
    expect(after?.completedAt).toBeNull();
    expect(after?.inferenceCompletedAt).toBeNull();
    expect(after?.inferenceProvider).toBeNull();
    expect(after?.inferenceModel).toBeNull();
    expect(after?.costUsd).toBeNull();
    expect(after?.chunksInserted).toBe(0);
    expect(after?.chunksRejectedByExclusion).toBe(0);
    expect(after?.chunksRejectedByRedaction).toBe(0);
    expect(after?.lockedAt).toBeNull();
    expect(after?.lockedBy).toBeNull();
    expect(after?.heartbeatAt).toBeNull();
  });

  it("the reset job is immediately claimable (attempt_count 0 -> 1)", async () => {
    const sid = await makeSession();
    const id = await makePermanentlyFailed(sid, 1);
    await resetPermanentlyFailed(id);

    const claimed = await claimNextDueJob("worker-A");
    expect(claimed?.id).toBe(id);
    expect(claimed?.status).toBe("running");
    expect(claimed?.attemptCount).toBe(1);
  });

  it("returns not_found for a non-existent id", async () => {
    const r = await resetPermanentlyFailed(999_999);
    expect(r).toEqual({ ok: false, reason: "not_found" });
  });

  it("returns not_permanently_failed for a non-terminal row and leaves it unchanged", async () => {
    const sid = await makeSession();
    const enq = await enqueueJob(newJob(sid, 1)); // status 'pending'
    const r = await resetPermanentlyFailed(enq.job.id);
    expect(r).toEqual({ ok: false, reason: "not_permanently_failed" });
    const after = await getById(enq.job.id);
    expect(after?.status).toBe("pending");
  });
});
