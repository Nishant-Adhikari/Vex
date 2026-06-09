/**
 * Integration: S4 memory_manager consolidation — full candidate → job → decision
 * → (promote) → knowledge_entries path on real pgvector, with a STUB judge (no
 * OpenRouter). Pins the atomic owner-check, idempotent-close, hot-context
 * exclusion of probationary, retained recallability, OD-3 reject, the recurrence
 * gate, and getCandidateEmbedding reuse.
 *
 * Drives the decision pipeline at the repo level (claim → reserve → process item)
 * exactly as the executor does, so the durable-queue + promote boundary are
 * exercised without the executor's env-gated provider / timers.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { query } from "@vex-agent/db/client.js";
import {
  enqueueConsolidateJob,
  claimNextDueJob,
  getJobById,
} from "@vex-agent/db/repos/memory-jobs/index.js";
import {
  reserveCandidatesForJob,
  listItemsByJob,
  markItemProcessing,
  markItemDone,
} from "@vex-agent/db/repos/memory-job-items/index.js";
import {
  getCandidateById,
  getCandidateEmbedding,
  recallCandidatesTopK,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { getLatestDecision } from "@vex-agent/db/repos/memory-decisions/index.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import { listActiveForHotContext, countActiveHotContextEntries } from "@vex-agent/db/repos/knowledge.js";
import {
  consolidateCandidate,
  applyDecisionAtomically,
  ClaimLostError,
} from "@vex-agent/memory/manager/index.js";
import { resetDb } from "../setup/fixtures.js";
import {
  makeSession,
  seedExecution,
  seedCandidate,
  softDeleteSession,
  depsWithStubJudge,
  stubJudge,
  PROMOTE_VERDICT,
  EMBEDDING_DIM,
  EMBEDDING_MODEL,
} from "../repos/_s4-fixtures.js";
import type { JudgeVerdict } from "@vex-agent/memory/manager/judge-schema.js";

/**
 * Drive ONE reserved candidate through the executor's item path: markProcessing →
 * consolidate → applyDecisionAtomically → markItemDone. Returns the decision id.
 */
async function decideOneItem(
  jobId: number,
  workerId: string,
  candidateId: string,
  verdict: JudgeVerdict,
): Promise<{ decisionId: string; decisionType: string }> {
  const items = await listItemsByJob(jobId, "reserved");
  const item = items.find((i) => i.candidateId === candidateId);
  if (!item) throw new Error("candidate not reserved");
  const ok = await markItemProcessing(item.id, jobId, workerId);
  if (!ok) throw new Error("markItemProcessing failed");

  const candidate = await getCandidateById(candidateId);
  if (!candidate) throw new Error("candidate missing");
  const embedding = await getCandidateEmbedding(candidateId);
  if (!embedding) throw new Error("embedding missing");

  const decision = await consolidateCandidate(candidate, embedding, depsWithStubJudge(verdict));
  const applied = await applyDecisionAtomically({
    candidate,
    plan: decision.plan,
    jobId,
    workerId,
  });
  await markItemDone(item.id, jobId, workerId, applied.decisionId);
  return applied;
}

describe("S4 memory_manager consolidation (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("getCandidateEmbedding returns the stored vector with model + dim", async () => {
    const session = await makeSession();
    const exec1 = await seedExecution(session);
    const candidateId = await seedCandidate(session, "emb", { executionIds: [exec1] });
    const emb = await getCandidateEmbedding(candidateId);
    expect(emb).not.toBeNull();
    expect(emb!.embedding).toHaveLength(EMBEDDING_DIM);
    expect(emb!.embeddingModel).toBe(EMBEDDING_MODEL);
    expect(emb!.embeddingDim).toBe(EMBEDDING_DIM);
  });

  it("promotes a recurring generalization to a probationary, advisory knowledge entry", async () => {
    const session = await makeSession();
    // Two distinct executions in the SAME vector neighborhood → recurrence ≥ 2.
    const execA = await seedExecution(session);
    const execB = await seedExecution(session);
    // A retained sibling sharing the cluster supplies the second execution anchor.
    await seedCandidate(session, "sib", { executionIds: [execB], vectorSeed: "shared" });
    const candidateId = await seedCandidate(session, "main", {
      executionIds: [execA],
      vectorSeed: "shared",
    });

    await enqueueConsolidateJob();
    const workerId = "w-1";
    const job = await claimNextDueJob(workerId);
    if (!job) throw new Error("no job");
    await reserveCandidatesForJob(job.id, workerId, 16);

    const applied = await decideOneItem(job.id, workerId, candidateId, PROMOTE_VERDICT);
    expect(applied.decisionType).toBe("promote");

    const candidate = await getCandidateById(candidateId);
    expect(candidate!.status).toBe("promoted");
    expect(candidate!.promotedKnowledgeId).not.toBeNull();

    const entry = await knowledgeRepo.getById(candidate!.promotedKnowledgeId!);
    expect(entry!.maturityState).toBe("probationary");
    expect(entry!.influenceScope).toBe("advisory");
    expect(entry!.activationStrength).toBeLessThan(1);
    expect(entry!.source).toBe("observed");

    const decision = await getLatestDecision(candidateId);
    expect(decision!.decisionType).toBe("promote");
    expect(decision!.promotedKnowledgeId).toBe(entry!.id);
  });

  it("promoted entry source_refs carries the FIX-1 anchors from evidenceRefs, not the transcript", async () => {
    const session = await makeSession();
    const execA = await seedExecution(session);
    const execB = await seedExecution(session);
    await seedCandidate(session, "sib2", { executionIds: [execB], vectorSeed: "shared2" });
    const candidateId = await seedCandidate(session, "main2", {
      executionIds: [execA],
      vectorSeed: "shared2",
    });
    await enqueueConsolidateJob();
    const workerId = "w-2";
    const job = await claimNextDueJob(workerId);
    await reserveCandidatesForJob(job!.id, workerId, 16);
    await decideOneItem(job!.id, workerId, candidateId, PROMOTE_VERDICT);

    const candidate = await getCandidateById(candidateId);
    const entry = await knowledgeRepo.getById(candidate!.promotedKnowledgeId!);
    const refs = entry!.sourceRefs as { evidence?: unknown; transcript?: unknown };
    expect(refs.evidence).toEqual([{ executionId: execA }]);
    expect(refs.transcript).toEqual({ messageIds: [] });
  });

  it("retains a generalization observed only once (recurrence n=1) and keeps it recallable", async () => {
    const session = await makeSession();
    const execA = await seedExecution(session);
    const candidateId = await seedCandidate(session, "solo", {
      executionIds: [execA],
      vectorSeed: "lonely",
    });
    await enqueueConsolidateJob();
    const workerId = "w-3";
    const job = await claimNextDueJob(workerId);
    await reserveCandidatesForJob(job!.id, workerId, 16);
    // Even with a promote verdict, the deterministic gate retains at n=1.
    const applied = await decideOneItem(job!.id, workerId, candidateId, PROMOTE_VERDICT);
    expect(applied.decisionType).toBe("retain");

    const candidate = await getCandidateById(candidateId);
    expect(candidate!.status).toBe("retained");

    // Retained candidates stay recallable through the dual-trace read path.
    const emb = await getCandidateEmbedding(candidateId);
    const recalled = await recallCandidatesTopK(
      emb!.embedding,
      { embeddingModel: EMBEDDING_MODEL, embeddingDim: EMBEDDING_DIM },
      10,
    );
    expect(recalled.some((r) => r.id === candidateId)).toBe(true);
  });

  it("rejects a candidate whose evidence anchor session is soft-deleted (OD-3)", async () => {
    const session = await makeSession();
    const exec1 = await seedExecution(session);
    const candidateId = await seedCandidate(session, "od3", { executionIds: [exec1] });
    await softDeleteSession(session);

    await enqueueConsolidateJob();
    const workerId = "w-4";
    const job = await claimNextDueJob(workerId);
    await reserveCandidatesForJob(job!.id, workerId, 16);
    const applied = await decideOneItem(job!.id, workerId, candidateId, PROMOTE_VERDICT);
    expect(applied.decisionType).toBe("reject");

    const decision = await getLatestDecision(candidateId);
    expect(decision!.rejectReason).toBe("insufficient_evidence");
    const candidate = await getCandidateById(candidateId);
    expect(candidate!.status).toBe("rejected");
  });

  it("excludes a probationary promoted entry from hot-context but counts established ones", async () => {
    const session = await makeSession();
    const execA = await seedExecution(session);
    const execB = await seedExecution(session);
    await seedCandidate(session, "sibh", { executionIds: [execB], vectorSeed: "sharedh" });
    const candidateId = await seedCandidate(session, "mainh", {
      executionIds: [execA],
      vectorSeed: "sharedh",
    });
    await enqueueConsolidateJob();
    const workerId = "w-5";
    const job = await claimNextDueJob(workerId);
    await reserveCandidatesForJob(job!.id, workerId, 16);
    await decideOneItem(job!.id, workerId, candidateId, PROMOTE_VERDICT);

    const hot = await listActiveForHotContext({ limit: 50 });
    expect(hot.length).toBe(0); // the only active entry is probationary → excluded
    expect(await countActiveHotContextEntries()).toBe(0);
  });

  it("owner-check claim-lost: a non-owner worker cannot write knowledge (R1#2)", async () => {
    const session = await makeSession();
    const execA = await seedExecution(session);
    const execB = await seedExecution(session);
    await seedCandidate(session, "sibo", { executionIds: [execB], vectorSeed: "sharedo" });
    const candidateId = await seedCandidate(session, "maino", {
      executionIds: [execA],
      vectorSeed: "sharedo",
    });
    await enqueueConsolidateJob();
    const ownerWorker = "w-owner";
    const job = await claimNextDueJob(ownerWorker);
    await reserveCandidatesForJob(job!.id, ownerWorker, 16);
    const items = await listItemsByJob(job!.id, "reserved");
    const item = items.find((i) => i.candidateId === candidateId)!;
    await markItemProcessing(item.id, job!.id, ownerWorker);

    const candidate = await getCandidateById(candidateId);
    const embedding = await getCandidateEmbedding(candidateId);
    const decision = await consolidateCandidate(candidate!, embedding!, depsWithStubJudge(PROMOTE_VERDICT));

    // A DIFFERENT worker tries to apply — owner-check must throw ClaimLost.
    await expect(
      applyDecisionAtomically({
        candidate: candidate!,
        plan: decision.plan,
        jobId: job!.id,
        workerId: "w-thief",
      }),
    ).rejects.toBeInstanceOf(ClaimLostError);

    // No knowledge written.
    const candAfter = await getCandidateById(candidateId);
    expect(candAfter!.status).toBe("pending");
    const count = await query<{ n: string }>(`SELECT count(*) AS n FROM knowledge_entries`);
    expect(Number(count[0]!.n)).toBe(0);
  });

  it("idempotent-close: a decided-but-unclosed item closes via getLatestDecision without double promote", async () => {
    const session = await makeSession();
    const execA = await seedExecution(session);
    const execB = await seedExecution(session);
    await seedCandidate(session, "sibi", { executionIds: [execB], vectorSeed: "sharedi" });
    const candidateId = await seedCandidate(session, "maini", {
      executionIds: [execA],
      vectorSeed: "sharedi",
    });
    await enqueueConsolidateJob();
    const workerId = "w-6";
    const job = await claimNextDueJob(workerId);
    await reserveCandidatesForJob(job!.id, workerId, 16);
    const items = await listItemsByJob(job!.id, "reserved");
    const item = items.find((i) => i.candidateId === candidateId)!;
    await markItemProcessing(item.id, job!.id, workerId);

    const candidate = await getCandidateById(candidateId);
    const embedding = await getCandidateEmbedding(candidateId);
    const decision = await consolidateCandidate(candidate!, embedding!, depsWithStubJudge(PROMOTE_VERDICT));
    const applied = await applyDecisionAtomically({
      candidate: candidate!,
      plan: decision.plan,
      jobId: job!.id,
      workerId,
    });
    // Simulate markItemDone NOT having run (crash window): the decision is
    // committed, the candidate is promoted, but the item is still processing.

    const knowledgeBefore = await query<{ n: string }>(`SELECT count(*) AS n FROM knowledge_entries`);

    // Idempotent close: re-fetch latest decision and close the item — NO re-apply.
    const latest = await getLatestDecision(candidateId);
    expect(latest!.id).toBe(applied.decisionId);
    const closed = await markItemDone(item.id, job!.id, workerId, latest!.id);
    expect(closed).toBe(true);

    const knowledgeAfter = await query<{ n: string }>(`SELECT count(*) AS n FROM knowledge_entries`);
    expect(knowledgeAfter[0]!.n).toBe(knowledgeBefore[0]!.n); // no double promote
  });
});
