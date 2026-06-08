/**
 * Integration: memory_candidates repo CRUD + DB CHECK enforcement + dedupe (S1b).
 *
 * Runs against the ephemeral pgvector container from `setup/globalSetup.ts`
 * (the repo's canonical live-DB harness — same one the session-memories repo
 * suites use). S1b does NOT embed (FIX-4): every candidate is stored with a
 * synthetic vector via `randVector`, so this suite exercises only DB + repo
 * logic, never the embeddings endpoint.
 *
 * Coverage (S1b spec §8):
 * - insert → get → mapRow fidelity for ALL columns (uuid, evidence_refs,
 *   source_refs, point-in-time);
 * - serial dedupe (2nd pending insert of the same content_hash → inserted=false,
 *   returns the existing row);
 * - MF1 concurrency: two PARALLEL inserts of the same content_hash → exactly one
 *   inserted=true, one inserted=false, one row total (proves the xmax upsert);
 * - status transition sets promoted_knowledge_id + precondition/not_found paths;
 * - named CHECK constraints reject bad enum / dim / importance / confidence /
 *   array-shape;
 * - FK to sessions enforced.
 */

import { createHash, randomUUID } from "node:crypto";

import { describe, it, expect, beforeEach } from "vitest";

import { execute, query } from "@vex-agent/db/client.js";
import {
  insertCandidate,
  getCandidateById,
  updateCandidateStatus,
  listCandidatesByStatus,
  type InsertCandidateInput,
} from "@vex-agent/db/repos/memory-candidates/index.js";
import type { CandidateProposedBy } from "@vex-agent/memory/schema/memory-candidate-enums.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";
import { makeSession, randVector, resetDb } from "../setup/fixtures.js";

const EMBEDDING_DIM = 8;
const EMBEDDING_MODEL = "test-model";

/** Distinct 64-char hex content hash from a seed. */
function hex64(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

function baseInput(
  sessionId: string,
  overrides: Partial<InsertCandidateInput> = {},
): InsertCandidateInput {
  return {
    sessionId,
    proposedBy: "parent",
    kind: "trade_lesson",
    title: "Candidate title",
    summary: "A short candidate summary.",
    contentMd: "Full candidate body.",
    entities: ["SOL"],
    tags: ["risk", "perp"],
    sourceRefs: { messageIds: [1, 2], toolCallIds: ["call_abc"] },
    evidenceRefs: [
      { executionId: 5, captureItemId: 9, instrumentKey: "SOL-PERP", positionKey: "pos:1" },
    ],
    source: "observed",
    confidence: 0.75,
    importance: 7,
    sensitivity: "normal",
    evidenceStrength: "weak",
    retrievalVisibility: "not_consolidated",
    retrievalUntil: null,
    retainUntil: null,
    embedding: randVector(EMBEDDING_DIM, "cand-seed"),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    contentHash: hex64("base"),
    eventTime: new Date("2026-06-01T00:00:00.000Z"),
    observedAt: new Date("2026-06-02T00:00:00.000Z"),
    availableAtDecisionTime: new Date("2026-06-03T00:00:00.000Z"),
    ...overrides,
  };
}

/** Seed a minimal knowledge_entries row (raw SQL) and return its serial id. */
async function seedKnowledgeEntry(): Promise<number> {
  const rows = await query<{ id: number }>(
    `INSERT INTO knowledge_entries
       (kind, title, summary, content_hash, embedding_model, embedding_dim, embedding)
     VALUES ('k', 't', 's', $1, $2, $3, $4::vector)
     RETURNING id`,
    [hex64("ke-seed"), EMBEDDING_MODEL, EMBEDDING_DIM, `[${randVector(EMBEDDING_DIM, "ke").join(",")}]`],
  );
  if (rows.length === 0) throw new Error("seedKnowledgeEntry: no id returned");
  return rows[0].id;
}

describe("memory_candidates repo CRUD (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("insert → get → mapRow fidelity across all columns", async () => {
    const sid = await makeSession();
    const input = baseInput(sid, { contentHash: hex64("fidelity") });

    const { candidate, inserted } = await insertCandidate(input);
    expect(inserted).toBe(true);
    expect(candidate.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );

    const got = await getCandidateById(candidate.id);
    expect(got).not.toBeNull();
    if (!got) throw new Error("unreachable");

    expect(got.sessionId).toBe(sid);
    expect(got.proposedBy).toBe("parent");
    expect(got.kind).toBe("trade_lesson");
    expect(got.title).toBe(input.title);
    expect(got.summary).toBe(input.summary);
    expect(got.contentMd).toBe(input.contentMd);
    expect(got.entities).toEqual(["SOL"]);
    expect(got.tags).toEqual(["risk", "perp"]);
    // JSONB round-trips verbatim.
    expect(got.sourceRefs).toEqual({ messageIds: [1, 2], toolCallIds: ["call_abc"] });
    expect(got.evidenceRefs).toEqual([
      { executionId: 5, captureItemId: 9, instrumentKey: "SOL-PERP", positionKey: "pos:1" },
    ]);
    expect(got.outcome).toBeNull();
    expect(got.source).toBe("observed");
    expect(got.confidence).toBeCloseTo(0.75, 5);
    expect(got.importance).toBe(7);
    expect(got.sensitivity).toBe("normal");
    expect(got.evidenceStrength).toBe("weak");
    expect(got.retrievalVisibility).toBe("not_consolidated");
    expect(got.status).toBe("pending");
    expect(got.embeddingModel).toBe(EMBEDDING_MODEL);
    expect(got.embeddingDim).toBe(EMBEDDING_DIM);
    expect(got.contentHash).toBe(input.contentHash);
    expect(got.promotedKnowledgeId).toBeNull();
    // Point-in-time fidelity (driver hands back Date or ISO string — normalize).
    expect(new Date(got.eventTime as string).toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(new Date(got.observedAt as string).toISOString()).toBe("2026-06-02T00:00:00.000Z");
    expect(new Date(got.availableAtDecisionTime as string).toISOString()).toBe(
      "2026-06-03T00:00:00.000Z",
    );
    expect(got.recordedAt).toBeTruthy();
    expect(got.createdAt).toBeTruthy();
    expect(got.updatedAt).toBeTruthy();
  });

  it("dedupes a 2nd pending insert of the same content_hash (returns existing)", async () => {
    const sid = await makeSession();
    const hash = hex64("dedupe");
    const a = await insertCandidate(baseInput(sid, { contentHash: hash }));
    const b = await insertCandidate(
      baseInput(sid, { contentHash: hash, title: "DIFFERENT title (ignored on conflict)" }),
    );

    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(b.candidate.id).toBe(a.candidate.id);
    // Existing row is returned untouched — conflict does NOT overwrite metadata.
    expect(b.candidate.title).toBe("Candidate title");

    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_candidates WHERE content_hash = $1",
      [hash],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("MF1: two PARALLEL same-hash inserts → exactly one inserted, one row total", async () => {
    const sid = await makeSession();
    const hash = hex64("race");
    const input = baseInput(sid, { contentHash: hash });

    const [a, b] = await Promise.all([
      insertCandidate(input),
      insertCandidate(input),
    ]);

    // Neither call threw (the racy DO NOTHING + CTE UNION manifested as
    // "upsert returned no row"). Both reference the same canonical row.
    expect(a.candidate.id).toBe(b.candidate.id);
    // Exactly one observed the fresh INSERT (xmax = 0).
    expect([a.inserted, b.inserted].filter(Boolean).length).toBe(1);

    const rows = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM memory_candidates WHERE content_hash = $1",
      [hash],
    );
    expect(rows[0]!.n).toBe("1");
  });

  it("updateCandidateStatus promotes and sets promoted_knowledge_id", async () => {
    const sid = await makeSession();
    const keId = await seedKnowledgeEntry();
    const { candidate } = await insertCandidate(baseInput(sid, { contentHash: hex64("promote") }));

    const res = await updateCandidateStatus(candidate.id, "promoted", {
      expectedFromStatus: "pending",
      promotedKnowledgeId: keId,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("unreachable");
    expect(res.candidate.status).toBe("promoted");
    expect(res.candidate.promotedKnowledgeId).toBe(keId);

    const got = await getCandidateById(candidate.id);
    expect(got?.status).toBe("promoted");
    expect(got?.promotedKnowledgeId).toBe(keId);
  });

  it("updateCandidateStatus respects the precondition and reports not_found", async () => {
    const sid = await makeSession();
    const { candidate } = await insertCandidate(baseInput(sid, { contentHash: hex64("precond") }));

    // Wrong expected from-status → precondition_failed, currentStatus reported.
    const wrong = await updateCandidateStatus(candidate.id, "rejected", {
      expectedFromStatus: "promoted",
    });
    expect(wrong.ok).toBe(false);
    if (wrong.ok) throw new Error("unreachable");
    expect(wrong.reason).toBe("precondition_failed");
    if (wrong.reason !== "precondition_failed") throw new Error("unreachable");
    expect(wrong.currentStatus).toBe("pending");

    // Unknown id → not_found.
    const missing = await updateCandidateStatus(randomUUID(), "rejected", {
      expectedFromStatus: "pending",
    });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("unreachable");
    expect(missing.reason).toBe("not_found");

    // A non-promoted transition leaves promoted_knowledge_id null.
    const rejected = await updateCandidateStatus(candidate.id, "rejected", {
      expectedFromStatus: "pending",
    });
    expect(rejected.ok).toBe(true);
    if (!rejected.ok) throw new Error("unreachable");
    expect(rejected.candidate.promotedKnowledgeId).toBeNull();
  });

  it("listCandidatesByStatus returns pending rows oldest-first", async () => {
    const sid = await makeSession();
    await insertCandidate(baseInput(sid, { contentHash: hex64("list-1") }));
    await insertCandidate(baseInput(sid, { contentHash: hex64("list-2") }));
    const { candidate: promoted } = await insertCandidate(
      baseInput(sid, { contentHash: hex64("list-3") }),
    );
    await updateCandidateStatus(promoted.id, "rejected", { expectedFromStatus: "pending" });

    const pending = await listCandidatesByStatus("pending", 10);
    expect(pending).toHaveLength(2);
    expect(pending.every((c) => c.status === "pending")).toBe(true);

    // Non-positive limit short-circuits to [].
    expect(await listCandidatesByStatus("pending", 0)).toEqual([]);
  });

  describe("named CHECK constraints reject invalid values", () => {
    it("rejects importance out of range (mc_importance_range)", async () => {
      const sid = await makeSession();
      await expect(
        insertCandidate(baseInput(sid, { contentHash: hex64("imp0"), importance: 0 })),
      ).rejects.toThrow(/mc_importance_range/);
      await expect(
        insertCandidate(baseInput(sid, { contentHash: hex64("imp11"), importance: 11 })),
      ).rejects.toThrow(/mc_importance_range/);
    });

    it("rejects confidence out of range (mc_confidence_range)", async () => {
      const sid = await makeSession();
      await expect(
        insertCandidate(baseInput(sid, { contentHash: hex64("conf"), confidence: 1.5 })),
      ).rejects.toThrow(/mc_confidence_range/);
    });

    it("rejects a bad proposed_by / source enum value (mc_*_valid)", async () => {
      const sid = await makeSession();
      await expect(
        insertCandidate(
          baseInput(sid, {
            contentHash: hex64("pb"),
            // Cast to force an out-of-vocab value past TS to prove the DB CHECK.
            proposedBy: "alien" as CandidateProposedBy,
          }),
        ),
      ).rejects.toThrow(/mc_proposed_by_valid/);
      await expect(
        insertCandidate(
          baseInput(sid, {
            contentHash: hex64("src"),
            source: "made_up" as KnowledgeSource,
          }),
        ),
      ).rejects.toThrow(/mc_source_valid/);
    });

    it("rejects an embedding whose dim does not match the vector (mc_embedding_dim_matches_vector)", async () => {
      const sid = await makeSession();
      // Bypass the repo's length precheck by inserting raw: 8-dim vector, dim=4.
      await expect(
        execute(
          `INSERT INTO memory_candidates
             (session_id, kind, title, summary, embedding, embedding_model, embedding_dim, content_hash)
           VALUES ($1, 'k', 't', 's', '[1,2,3,4,5,6,7,8]'::vector, $2, 4, $3)`,
          [sid, EMBEDDING_MODEL, hex64("dimmismatch")],
        ),
      ).rejects.toThrow(/mc_embedding_dim_matches_vector/);
    });

    it("rejects a non-array evidence_refs / non-object source_refs (jsonb shape CHECKs)", async () => {
      const sid = await makeSession();
      await expect(
        execute(
          `INSERT INTO memory_candidates
             (session_id, kind, title, summary, embedding, embedding_model, embedding_dim, content_hash, evidence_refs)
           VALUES ($1, 'k', 't', 's', '[1,2,3,4,5,6,7,8]'::vector, $2, 8, $3, '{}'::jsonb)`,
          [sid, EMBEDDING_MODEL, hex64("evobj")],
        ),
      ).rejects.toThrow(/mc_evidence_refs_is_array/);
      await expect(
        execute(
          `INSERT INTO memory_candidates
             (session_id, kind, title, summary, embedding, embedding_model, embedding_dim, content_hash, source_refs)
           VALUES ($1, 'k', 't', 's', '[1,2,3,4,5,6,7,8]'::vector, $2, 8, $3, '[]'::jsonb)`,
          [sid, EMBEDDING_MODEL, hex64("srarr")],
        ),
      ).rejects.toThrow(/mc_source_refs_is_object/);
    });
  });

  it("enforces the FK to sessions (session_id must exist)", async () => {
    await expect(
      insertCandidate(baseInput("session-does-not-exist", { contentHash: hex64("fk") })),
    ).rejects.toThrow(/foreign key|session/i);
  });
});
