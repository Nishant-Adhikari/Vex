/**
 * Integration: memory_job_items repo — reservation guard, owner-checks, partial
 * progress, done-requires-decision, retry revive, FK + CHECK enforcement (S1c).
 */

import { describe, it, expect, beforeEach } from "vitest";

import { execute, query } from "@vex-agent/db/client.js";
import {
  enqueueConsolidateJob,
  claimNextDueJob,
  getJobProgress,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import {
  reserveCandidatesForJob,
  markItemProcessing,
  markItemDone,
  markItemFailed,
  releaseItemsForJob,
  listItemsByJob,
} from "@vex-agent/db/repos/memory-job-items/index.js";
import { recordDecision } from "@vex-agent/db/repos/memory-decisions/index.js";
import { resetDb } from "../setup/fixtures.js";
import { makeSession, seedPendingCandidates } from "./_s1c-fixtures.js";

/** Enqueue + claim a consolidate job owned by `workerId`; return its id. */
async function claimJob(workerId: string): Promise<number> {
  await enqueueConsolidateJob();
  const job = await claimNextDueJob(workerId);
  if (!job) throw new Error("claimJob: nothing claimable");
  return job.id;
}

async function recordRetainDecision(candidateId: string, jobId: number): Promise<string> {
  const res = await recordDecision({
    decisionType: "retain",
    candidateId,
    jobId,
    decisionVersion: 0,
  });
  if (!res.ok) throw new Error("recordRetainDecision: idempotency_conflict");
  return res.decision.id;
}

describe("memory_job_items repo (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("reservation guard: two jobs over one pool → each candidate held by ≤1 job", async () => {
    const sid = await makeSession();
    const candIds = await seedPendingCandidates(sid, 6, "guard");
    const jobA = await claimJob("A");
    const jobB = await claimJob("B");

    const [a, b] = await Promise.all([
      reserveCandidatesForJob(jobA, "A", 6),
      reserveCandidatesForJob(jobB, "B", 6),
    ]);

    // Disjoint, and together they cover the whole pool (no double-reservation).
    const overlap = a.filter((id) => b.includes(id));
    expect(overlap).toHaveLength(0);
    expect(new Set([...a, ...b])).toEqual(new Set(candIds));

    // Each candidate has at most one ACTIVE (reserved|processing) item.
    const dup = await query<{ candidate_id: string; n: string }>(
      `SELECT candidate_id, count(*)::text AS n FROM memory_job_items
        WHERE item_status IN ('reserved','processing') GROUP BY candidate_id HAVING count(*) > 1`,
    );
    expect(dup).toHaveLength(0);
  });

  it("owner-checked reservation: non-owner / non-running job reserves nothing", async () => {
    const sid = await makeSession();
    await seedPendingCandidates(sid, 3, "owner");
    const jobId = await claimJob("owner");

    // Wrong worker → nothing.
    expect(await reserveCandidatesForJob(jobId, "intruder", 5)).toEqual([]);

    // A pending (unclaimed) job → nothing.
    const pending = await enqueueConsolidateJob();
    expect(await reserveCandidatesForJob(pending.id, "anyone", 5)).toEqual([]);

    // The real owner still reserves.
    expect(await reserveCandidatesForJob(jobId, "owner", 5)).toHaveLength(3);
  });

  it("partial progress: items advance independently; a failed item does not block", async () => {
    const sid = await makeSession();
    const candIds = await seedPendingCandidates(sid, 3, "partial");
    const jobId = await claimJob("w");
    await reserveCandidatesForJob(jobId, "w", 3);
    const items = await listItemsByJob(jobId);
    expect(items).toHaveLength(3);

    // one → processing → done (with decision); one → failed; one stays reserved.
    expect(await markItemProcessing(items[0]!.id, jobId, "w")).toBe(true);
    const decId = await recordRetainDecision(candIds[0]!, jobId);
    expect(await markItemDone(items[0]!.id, jobId, "w", decId)).toBe(true);
    expect(await markItemFailed(items[1]!.id, jobId, "w", "transient_error")).toBe(true);

    expect(await getJobProgress(jobId)).toMatchObject({
      done: 1,
      failed: 1,
      reserved: 1,
      total: 3,
    });
  });

  it("done REQUIRES a decision (mji_done_has_decision + uniq_mji_decision)", async () => {
    const sid = await makeSession();
    const candIds = await seedPendingCandidates(sid, 2, "done");
    const jobId = await claimJob("w");
    await reserveCandidatesForJob(jobId, "w", 2);
    const items = await listItemsByJob(jobId);

    // Raw UPDATE to 'done' WITHOUT a decision_id → CHECK rejects.
    await expect(
      execute("UPDATE memory_job_items SET item_status='done' WHERE id=$1", [items[0]!.id]),
    ).rejects.toThrow(/mji_done_has_decision/);

    // markItemDone with a real decision succeeds and links it.
    const decId = await recordRetainDecision(candIds[0]!, jobId);
    expect(await markItemDone(items[0]!.id, jobId, "w", decId)).toBe(true);
    const done = (await listItemsByJob(jobId)).find((i) => i.id === items[0]!.id)!;
    expect(done.itemStatus).toBe("done");
    expect(done.decisionId).toBe(decId);

    // A second item cannot link the SAME decision (uniq_mji_decision).
    await expect(
      execute("UPDATE memory_job_items SET item_status='done', decision_id=$1 WHERE id=$2", [
        decId,
        items[1]!.id,
      ]),
    ).rejects.toThrow(/uniq_mji_decision/);
  });

  it("markItemDone refuses a decision that belongs to a different candidate", async () => {
    const sid = await makeSession();
    const candIds = await seedPendingCandidates(sid, 2, "fg4");
    const jobId = await claimJob("w");
    await reserveCandidatesForJob(jobId, "w", 2);
    const items = await listItemsByJob(jobId);
    const itemA = items.find((i) => i.candidateId === candIds[0])!;
    // A decision recorded for candidate B (also reserved by this job).
    const decB = await recordRetainDecision(candIds[1]!, jobId);
    // Closing item A with B's decision must be refused — the UPDATE join requires
    // d.candidate_id = i.candidate_id, so no row matches and the item stays open.
    expect(await markItemDone(itemA.id, jobId, "w", decB)).toBe(false);
    expect((await listItemsByJob(jobId)).find((i) => i.id === itemA.id)!.itemStatus).not.toBe(
      "done",
    );
  });

  it("retry revive: a job re-reserves its OWN failed/released items (no strand)", async () => {
    const sid = await makeSession();
    const [candId] = await seedPendingCandidates(sid, 1, "revive");
    const jobId = await claimJob("w");
    await reserveCandidatesForJob(jobId, "w", 5);
    const item = (await listItemsByJob(jobId))[0]!;
    await markItemFailed(item.id, jobId, "w", "transient_error");

    // A different job cannot grab the failed candidate of another job? It CAN —
    // failed is not an active hold; but the OWNING job revives it without a new row.
    const revived = await reserveCandidatesForJob(jobId, "w", 5);
    expect(revived).toContain(candId);
    // Still exactly ONE item for (job, candidate) — revived in place, not duplicated.
    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_job_items WHERE job_id=$1 AND candidate_id=$2",
      [jobId, candId],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("cross-job hold is blocked while a candidate is actively reserved", async () => {
    const sid = await makeSession();
    const [candId] = await seedPendingCandidates(sid, 1, "hold");
    const jobA = await claimJob("A");
    const jobB = await claimJob("B");

    expect(await reserveCandidatesForJob(jobA, "A", 5)).toEqual([candId]);
    // jobB sees no free candidate (the only one is actively held by jobA).
    expect(await reserveCandidatesForJob(jobB, "B", 5)).toEqual([]);
  });

  it("markItem* transitions are owner-checked", async () => {
    const sid = await makeSession();
    const candIds = await seedPendingCandidates(sid, 1, "ownercheck");
    const jobId = await claimJob("owner");
    await reserveCandidatesForJob(jobId, "owner", 1);
    const item = (await listItemsByJob(jobId))[0]!;

    expect(await markItemProcessing(item.id, jobId, "intruder")).toBe(false);
    expect(await markItemFailed(item.id, jobId, "intruder", "x")).toBe(false);
    const decId = await recordRetainDecision(candIds[0]!, jobId);
    expect(await markItemDone(item.id, jobId, "intruder", decId)).toBe(false);
    // markItemDone with an empty decisionId is a programmer error (throws).
    await expect(markItemDone(item.id, jobId, "owner", "")).rejects.toThrow(/decisionId is required/);
    // Owner still works.
    expect(await markItemProcessing(item.id, jobId, "owner")).toBe(true);
  });

  it("releaseItemsForJob frees active items back to the pool", async () => {
    const sid = await makeSession();
    await seedPendingCandidates(sid, 2, "release");
    const jobId = await claimJob("w");
    await reserveCandidatesForJob(jobId, "w", 2);
    expect(await releaseItemsForJob(jobId)).toBe(2);
    expect(await getJobProgress(jobId)).toMatchObject({ released: 2, reserved: 0 });
  });

  describe("FK + CHECK enforcement", () => {
    it("cascades items when the parent job is deleted", async () => {
      const sid = await makeSession();
      await seedPendingCandidates(sid, 1, "fkjob");
      const jobId = await claimJob("w");
      await reserveCandidatesForJob(jobId, "w", 1);
      await execute("DELETE FROM memory_jobs WHERE id=$1", [jobId]);
      expect(await listItemsByJob(jobId)).toHaveLength(0);
    });

    it("cascades items when the candidate is deleted", async () => {
      const sid = await makeSession();
      const [candId] = await seedPendingCandidates(sid, 1, "fkcand");
      const jobId = await claimJob("w");
      await reserveCandidatesForJob(jobId, "w", 1);
      await execute("DELETE FROM memory_candidates WHERE id=$1", [candId]);
      expect(await listItemsByJob(jobId)).toHaveLength(0);
    });

    it("RESTRICTs deletion of a decision still linked by a done item", async () => {
      const sid = await makeSession();
      const [candId] = await seedPendingCandidates(sid, 1, "fkdec");
      const jobId = await claimJob("w");
      await reserveCandidatesForJob(jobId, "w", 1);
      const item = (await listItemsByJob(jobId))[0]!;
      const decId = await recordRetainDecision(candId, jobId);
      await markItemDone(item.id, jobId, "w", decId);
      await expect(
        execute("DELETE FROM memory_decisions WHERE id=$1", [decId]),
      ).rejects.toThrow(/foreign key|violates/i);
    });

    it("enforces mji_job_candidate_unique (one item per (job, candidate))", async () => {
      const sid = await makeSession();
      const [candId] = await seedPendingCandidates(sid, 1, "uniq");
      const jobId = await claimJob("w");
      await reserveCandidatesForJob(jobId, "w", 1);
      await expect(
        execute("INSERT INTO memory_job_items (job_id, candidate_id) VALUES ($1, $2)", [
          jobId,
          candId,
        ]),
      ).rejects.toThrow(/mji_job_candidate_unique/);
    });
  });
});
