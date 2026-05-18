/**
 * Integration: session-memories repo against a real Postgres + pgvector.
 *
 * Proofs requiring a live DB (not mockable):
 *   - Per-(session_id, content_hash) partial unique index dedupes only when
 *     status='active'; a second insert with identical theme + body returns
 *     `inserted: false` and the existing row.
 *   - `outstanding_items` JSONB array is preserved across round-trips and
 *     supports element-level resolution without losing siblings.
 *   - `getSessionMemoryStats` returns correct counts across resolved /
 *     unresolved outstanding items and distinct themes.
 *   - `recallTopK` mandatory filter on `(embedding_model, embedding_dim)` +
 *     session scope — cross-session rows never bleed in.
 *   - ON DELETE CASCADE removes memories when their session is deleted.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  insertMemories,
  recallTopK,
  listActiveBySession,
  getSessionMemoryStats,
  markOutstandingResolved,
  getById,
  type NewSessionMemory,
} from "@vex-agent/db/repos/session-memories/index.js";
import { execute } from "@vex-agent/db/client.js";
import { makeSession, randVector, resetDb } from "../setup/fixtures.js";

const EMBEDDING_MODEL = "test-model";
const EMBEDDING_DIM = 8;

function newMemory(
  sessionId: string,
  overrides: Partial<NewSessionMemory> & {
    theme: string;
    happenedMd: string;
  },
): NewSessionMemory {
  const seed = sessionId + "|" + overrides.theme + "|" + overrides.happenedMd;
  return {
    sessionId,
    checkpointGeneration: overrides.checkpointGeneration ?? 1,
    theme: overrides.theme,
    themeSource: overrides.themeSource ?? "chunker",
    entities: overrides.entities ?? [],
    protocols: overrides.protocols ?? [],
    errorClasses: overrides.errorClasses ?? [],
    chains: overrides.chains ?? [],
    tasks: overrides.tasks ?? [],
    happenedMd: overrides.happenedMd,
    didMd: overrides.didMd ?? "",
    triedMd: overrides.triedMd ?? "",
    outstandingTexts: overrides.outstandingTexts ?? [],
    sourceStartMessageId: overrides.sourceStartMessageId ?? null,
    sourceEndMessageId: overrides.sourceEndMessageId ?? null,
    inferenceModel: overrides.inferenceModel ?? "test-llm",
    importance: overrides.importance,
    confidence: overrides.confidence,
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    embedding: overrides.embedding ?? randVector(EMBEDDING_DIM, seed),
  };
}

describe("session-memories insertMemories dedupe (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("dedupes second insert with identical theme + body in same session", async () => {
    const sid = await makeSession();
    const input = newMemory(sid, {
      theme: "kyber_quote_timeout_pattern",
      happenedMd: "Detected repeated timeouts on Kyber quote endpoint.",
    });
    const first = await insertMemories([input]);
    expect(first).toHaveLength(1);
    expect(first[0].inserted).toBe(true);

    const second = await insertMemories([input]);
    expect(second).toHaveLength(1);
    expect(second[0].inserted).toBe(false);
    expect(second[0].memory.id).toBe(first[0].memory.id);
  });

  it("allows same theme+body in different sessions", async () => {
    const sidA = await makeSession();
    const sidB = await makeSession();
    const base = {
      theme: "solana_wallet_setup_pattern",
      happenedMd: "Standard Solana wallet setup completed.",
    };
    const a = await insertMemories([newMemory(sidA, base)]);
    const b = await insertMemories([newMemory(sidB, base)]);
    expect(a[0].inserted).toBe(true);
    expect(b[0].inserted).toBe(true);
    expect(a[0].memory.id).not.toBe(b[0].memory.id);
  });
});

describe("session-memories outstanding items (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("round-trips outstanding_items array with stable IDs", async () => {
    const sid = await makeSession();
    const inserted = await insertMemories([
      newMemory(sid, {
        theme: "wif_unwind_pending_decision",
        happenedMd: "Started WIF unwind.",
        outstandingTexts: [
          "Approve tx 0xabcd…1234",
          "Confirm POPCAT decision",
        ],
      }),
    ]);
    const memory = inserted[0].memory;
    expect(memory.outstandingItems).toHaveLength(2);
    expect(memory.outstandingItems[0].id).toMatch(/^[0-9a-f-]+$/);
    expect(memory.outstandingItems[0].resolvedAt).toBeNull();
    expect(memory.outstandingItems[1].text).toContain("POPCAT");
  });

  it("resolves a single item without affecting siblings", async () => {
    const sid = await makeSession();
    const inserted = await insertMemories([
      newMemory(sid, {
        theme: "multi_outstanding_partial_resolution_test",
        happenedMd: "Three pending items.",
        outstandingTexts: ["Item A", "Item B", "Item C"],
      }),
    ]);
    const memory = inserted[0].memory;
    const targetId = memory.outstandingItems[1].id;

    const result = await markOutstandingResolved(memory.id, targetId, "Done by user", "user");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.memory.outstandingItems[0].resolvedAt).toBeNull();
    expect(result.memory.outstandingItems[1].resolvedAt).not.toBeNull();
    expect(result.memory.outstandingItems[1].resolutionNote).toBe("Done by user");
    expect(result.memory.outstandingItems[1].resolutionSource).toBe("user");
    expect(result.memory.outstandingItems[2].resolvedAt).toBeNull();
  });

  it("rejects resolution of unknown item id", async () => {
    const sid = await makeSession();
    const inserted = await insertMemories([
      newMemory(sid, {
        theme: "single_outstanding_for_not_found_test",
        happenedMd: "One pending item.",
        outstandingTexts: ["Only item"],
      }),
    ]);
    const result = await markOutstandingResolved(
      inserted[0].memory.id,
      "00000000-0000-0000-0000-000000000000",
      "note",
      "agent",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("item_not_found");
  });

  it("rejects double-resolution of the same item", async () => {
    const sid = await makeSession();
    const inserted = await insertMemories([
      newMemory(sid, {
        theme: "double_resolution_should_be_rejected",
        happenedMd: "One pending item.",
        outstandingTexts: ["Only item"],
      }),
    ]);
    const itemId = inserted[0].memory.outstandingItems[0].id;
    const first = await markOutstandingResolved(inserted[0].memory.id, itemId, "n1", "agent");
    expect(first.ok).toBe(true);
    const second = await markOutstandingResolved(inserted[0].memory.id, itemId, "n2", "agent");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_resolved");
  });
});

describe("getSessionMemoryStats (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns zeros and empty list for fresh session", async () => {
    const sid = await makeSession();
    const stats = await getSessionMemoryStats(sid, 5);
    expect(stats.activeCount).toBe(0);
    expect(stats.compactCount).toBe(0);
    expect(stats.unresolvedOutstandingCount).toBe(0);
    expect(stats.recentThemes).toEqual([]);
  });

  it("counts active rows and unresolved outstanding correctly", async () => {
    const sid = await makeSession();
    await insertMemories([
      newMemory(sid, {
        theme: "alpha_pattern_observation",
        happenedMd: "Alpha.",
        outstandingTexts: ["A1", "A2"],
        checkpointGeneration: 1,
      }),
      newMemory(sid, {
        theme: "beta_pattern_observation",
        happenedMd: "Beta.",
        outstandingTexts: ["B1"],
        checkpointGeneration: 2,
      }),
    ]);
    // compactCount now reads `sessions.checkpoint_generation` directly so a
    // realistic test must also bump that column (the Phase II checkpoint tx
    // does this in production). Without the bump, compactCount returns 0
    // because Track 2 chunks alone do not advance the session counter.
    await execute("UPDATE sessions SET checkpoint_generation = 2 WHERE id = $1", [sid]);

    const stats = await getSessionMemoryStats(sid, 5);
    expect(stats.activeCount).toBe(2);
    expect(stats.compactCount).toBe(2);
    expect(stats.unresolvedOutstandingCount).toBe(3);
    expect(stats.recentThemes).toContain("alpha_pattern_observation");
    expect(stats.recentThemes).toContain("beta_pattern_observation");
  });

  it("compactCount reflects sessions.checkpoint_generation even with zero chunks (e.g. all rejected)", async () => {
    const sid = await makeSession();
    // Simulate a compact that completed in Phase II (generation bumped) but
    // Track 2 either still pending or all chunks rejected by exclusion.
    await execute("UPDATE sessions SET checkpoint_generation = 4 WHERE id = $1", [sid]);

    const stats = await getSessionMemoryStats(sid, 5);
    expect(stats.activeCount).toBe(0);
    expect(stats.compactCount).toBe(4);
    expect(stats.unresolvedOutstandingCount).toBe(0);
    expect(stats.recentThemes).toEqual([]);
  });

  it("decrements unresolved count after resolving but keeps active count", async () => {
    const sid = await makeSession();
    const inserted = await insertMemories([
      newMemory(sid, {
        theme: "resolution_keeps_active_count_check",
        happenedMd: "Tracking.",
        outstandingTexts: ["X", "Y"],
      }),
    ]);
    const xId = inserted[0].memory.outstandingItems[0].id;
    await markOutstandingResolved(inserted[0].memory.id, xId, "done", "user");

    const stats = await getSessionMemoryStats(sid, 5);
    expect(stats.activeCount).toBe(1);
    expect(stats.unresolvedOutstandingCount).toBe(1);
  });
});

describe("recallTopK session-scoped (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns only chunks from the requested session", async () => {
    const sidA = await makeSession();
    const sidB = await makeSession();
    await insertMemories([
      newMemory(sidA, { theme: "alpha_recall_test_session", happenedMd: "Alpha A" }),
      newMemory(sidB, { theme: "alpha_recall_test_session", happenedMd: "Alpha B" }),
    ]);

    const probe = randVector(EMBEDDING_DIM, "query-seed");
    const hitsA = await recallTopK(probe, {
      sessionId: sidA,
      embeddingModel: EMBEDDING_MODEL,
      embeddingDim: EMBEDDING_DIM,
      topK: 5,
    });
    expect(hitsA.length).toBeGreaterThan(0);
    for (const h of hitsA) expect(h.memory.sessionId).toBe(sidA);
  });

  it("filters by embedding model + dim before pgvector touches the row", async () => {
    const sid = await makeSession();
    await insertMemories([
      {
        ...newMemory(sid, { theme: "model_filter_test_alpha", happenedMd: "A" }),
        embeddingModel: "model-a",
      },
      {
        ...newMemory(sid, { theme: "model_filter_test_beta", happenedMd: "B" }),
        embeddingModel: "model-b",
      },
    ]);

    const probe = randVector(EMBEDDING_DIM, "probe");
    const hits = await recallTopK(probe, {
      sessionId: sid,
      embeddingModel: "model-a",
      embeddingDim: EMBEDDING_DIM,
      topK: 5,
    });
    for (const h of hits) expect(h.memory.embeddingModel).toBe("model-a");
  });
});

describe("cascade delete (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("removes session_memories rows when the parent session is deleted", async () => {
    const sid = await makeSession();
    const inserted = await insertMemories([
      newMemory(sid, { theme: "cascade_test_chunk_lives_here", happenedMd: "x" }),
    ]);
    expect(inserted[0].inserted).toBe(true);

    await execute("DELETE FROM sessions WHERE id = $1", [sid]);

    const orphan = await getById(inserted[0].memory.id);
    expect(orphan).toBeNull();
  });
});

describe("listActiveBySession ordering (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("returns rows by created_at DESC", async () => {
    const sid = await makeSession();
    await insertMemories([
      newMemory(sid, { theme: "first_chunk_inserted_order", happenedMd: "1" }),
      newMemory(sid, { theme: "second_chunk_inserted_order", happenedMd: "2" }),
      newMemory(sid, { theme: "third_chunk_inserted_order", happenedMd: "3" }),
    ]);
    const list = await listActiveBySession(sid, 10);
    expect(list).toHaveLength(3);
    // most-recent first
    expect(list[0].theme).toBe("third_chunk_inserted_order");
    expect(list[2].theme).toBe("first_chunk_inserted_order");
  });
});
