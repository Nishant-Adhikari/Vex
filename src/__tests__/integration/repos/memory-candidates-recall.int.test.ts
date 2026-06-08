/**
 * Integration: recallCandidatesTopK (S3 dual-trace vector recall).
 *
 * Runs against the ephemeral pgvector container from `setup/globalSetup.ts`.
 * S3 reads FRESH `not_consolidated` candidates as soft signals. This suite proves
 * the recall predicate end-to-end on a real pgvector index:
 *  - only `pending` + `not_consolidated` + non-expired rows are returned;
 *  - a suppressed, an expired, and a terminal candidate are each EXCLUDED;
 *  - results are ordered by cosine distance (closest first);
 *  - the mandatory embedding_model / embedding_dim filter excludes mismatches.
 *
 * Synthetic vectors via `randVector` — no embeddings endpoint is touched (S3
 * repo test seeds vectors directly; handler tests mock embed).
 */

import { createHash } from "node:crypto";

import { describe, it, expect, beforeEach } from "vitest";

import { execute } from "@vex-agent/db/client.js";
import {
  insertCandidate,
  recallCandidatesTopK,
  updateCandidateStatus,
  type InsertCandidateInput,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import { makeSession, randVector, resetDb } from "../setup/fixtures.js";

const EMBEDDING_DIM = 8;
const EMBEDDING_MODEL = "test-model";

function hex64(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function baseInput(
  sessionId: string,
  seed: string,
  overrides: Partial<InsertCandidateInput> = {},
): InsertCandidateInput {
  return {
    sessionId,
    proposedBy: "parent",
    kind: "trade_lesson",
    title: `Candidate ${seed}`,
    summary: "A short candidate summary.",
    contentMd: "Full candidate body.",
    entities: ["SOL"],
    tags: ["risk"],
    sourceRefs: { messageIds: [1] },
    evidenceRefs: [{ executionId: 5 }],
    source: "observed",
    confidence: null,
    importance: 5,
    sensitivity: "normal",
    evidenceStrength: "none",
    retrievalVisibility: "not_consolidated",
    retrievalUntil: null,
    retainUntil: null,
    embedding: randVector(EMBEDDING_DIM, `cand-${seed}`),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    contentHash: hex64(`cand-${seed}`),
    eventTime: null,
    observedAt: null,
    availableAtDecisionTime: null,
    ...overrides,
  };
}

const FILTER = { embeddingModel: EMBEDDING_MODEL, embeddingDim: EMBEDDING_DIM };

describe("recallCandidatesTopK (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns only pending + not_consolidated + non-expired candidates", async () => {
    const sid = await makeSession();
    const { candidate } = await insertCandidate(baseInput(sid, "fresh"));

    const results = await recallCandidatesTopK(randVector(EMBEDDING_DIM, "query"), FILTER, 8);
    expect(results.map((r) => r.id)).toEqual([candidate.id]);
    expect(results[0]!.similarity).toBeGreaterThanOrEqual(0);
    expect(results[0]!.similarity).toBeLessThanOrEqual(1);
    expect(results[0]!.source).toBe("observed");
  });

  it("excludes a suppressed candidate", async () => {
    const sid = await makeSession();
    // Insert as not_consolidated, then flip retrieval_visibility to suppressed.
    const { candidate } = await insertCandidate(baseInput(sid, "suppress"));
    await execute(
      "UPDATE memory_candidates SET retrieval_visibility = 'suppressed' WHERE id = $1",
      [candidate.id],
    );

    const results = await recallCandidatesTopK(randVector(EMBEDDING_DIM, "query"), FILTER, 8);
    expect(results).toHaveLength(0);
  });

  it("excludes an expired candidate (retrieval_until in the past)", async () => {
    const sid = await makeSession();
    await insertCandidate(
      baseInput(sid, "expired", {
        retrievalUntil: new Date(Date.now() - 60_000),
      }),
    );

    const results = await recallCandidatesTopK(randVector(EMBEDDING_DIM, "query"), FILTER, 8);
    expect(results).toHaveLength(0);
  });

  it("includes a candidate whose retrieval_until is in the future", async () => {
    const sid = await makeSession();
    const { candidate } = await insertCandidate(
      baseInput(sid, "future", {
        retrievalUntil: new Date(Date.now() + 60 * 60_000),
      }),
    );

    const results = await recallCandidatesTopK(randVector(EMBEDDING_DIM, "query"), FILTER, 8);
    expect(results.map((r) => r.id)).toEqual([candidate.id]);
  });

  it("excludes a terminal (non-pending) candidate", async () => {
    const sid = await makeSession();
    const { candidate } = await insertCandidate(baseInput(sid, "terminal"));
    await updateCandidateStatus(candidate.id, "rejected", { expectedFromStatus: "pending" });

    const results = await recallCandidatesTopK(randVector(EMBEDDING_DIM, "query"), FILTER, 8);
    expect(results).toHaveLength(0);
  });

  it("excludes candidates produced by a different embedding model / dim", async () => {
    const sid = await makeSession();
    const { candidate: same } = await insertCandidate(baseInput(sid, "same-model"));
    await insertCandidate(
      baseInput(sid, "other-model", { embeddingModel: "other-model" }),
    );

    const results = await recallCandidatesTopK(randVector(EMBEDDING_DIM, "query"), FILTER, 8);
    expect(results.map((r) => r.id)).toEqual([same.id]);
  });

  it("orders results by cosine distance (closest first)", async () => {
    const sid = await makeSession();
    // Query vector equals the embedding of `near` → distance 0 (closest).
    const nearVec = randVector(EMBEDDING_DIM, "near-vec");
    const farVec = randVector(EMBEDDING_DIM, "far-vec");
    const { candidate: near } = await insertCandidate(
      baseInput(sid, "near", { embedding: nearVec }),
    );
    const { candidate: far } = await insertCandidate(
      baseInput(sid, "far", { embedding: farVec }),
    );

    const results = await recallCandidatesTopK(nearVec, FILTER, 8);
    expect(results.map((r) => r.id)).toEqual([near.id, far.id]);
    expect(results[0]!.similarity).toBeGreaterThan(results[1]!.similarity);
  });

  it("returns [] for a non-positive k and throws on a dim mismatch", async () => {
    expect(await recallCandidatesTopK(randVector(EMBEDDING_DIM, "q"), FILTER, 0)).toEqual([]);
    await expect(
      recallCandidatesTopK(randVector(4, "short"), FILTER, 8),
    ).rejects.toThrow(/does not match filter dim/);
  });
});
