/**
 * Integration: PR3-final concurrent-resolution embedding race regression.
 *
 * The fix: `updateEmbedding` is conditional on `body_md_hash = $expected`.
 * When a concurrent `markOutstandingResolved` rewrites `body_md` (bumping
 * its hash), a stale embedding computed against the OLD body fails the
 * WHERE clause and the row is left untouched — the winning concurrent
 * caller's embedding stays.
 *
 * The test uses a deterministic SEQUENTIAL proof of the conditional rather
 * than Promise.all racing: we explicitly run the second resolve AFTER the
 * first, then try the stale `updateEmbedding` AFTER the fresh one. That
 * directly demonstrates the WHERE clause rejecting the stale write —
 * Promise.all could pass by luck even with the conditional broken
 * (interleaving may put the "stale" write first by accident).
 *
 * To prove no overwrite happened, the two `updateEmbedding` calls use
 * DISTINCT `embedding_model` strings; the final row's `embedding_model`
 * must equal the fresh-call's model (the stale call must not have
 * overwritten it).
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  getById,
  insertMemories,
  markOutstandingResolved,
  updateEmbedding,
  type NewSessionMemory,
} from "@vex-agent/db/repos/session-memories/index.js";
import { makeSession, randVector, resetDb } from "../setup/fixtures.js";

const EMBEDDING_MODEL = "test-model-base";
const EMBEDDING_DIM = 8;

function newMemoryWithOutstanding(
  sessionId: string,
  outstandingTexts: readonly string[],
): NewSessionMemory {
  return {
    sessionId,
    checkpointGeneration: 1,
    theme: "race_test_theme",
    themeSource: "chunker",
    entities: [],
    protocols: [],
    errorClasses: [],
    chains: [],
    tasks: [],
    happenedMd: "race fixture happened",
    didMd: "race fixture did",
    triedMd: "race fixture tried",
    outstandingTexts: [...outstandingTexts],
    sourceStartMessageId: null,
    sourceEndMessageId: null,
    languageCode: "en",
    inferenceModel: "test-llm",
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    embedding: randVector(EMBEDDING_DIM, "race-seed"),
  };
}

describe("session-memories updateEmbedding race fix (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("rejects stale embedding when body_md_hash has rotated under it", async () => {
    const sid = await makeSession();

    // Insert a memory with 2 outstanding items A and B. The repo wraps
    // outstandingTexts into OutstandingItem rows with server-generated UUIDs.
    const inserted = await insertMemories([
      newMemoryWithOutstanding(sid, ["item A — needs resolution", "item B — needs resolution"]),
    ]);
    expect(inserted).toHaveLength(1);
    const memoryId = inserted[0].memory.id;
    const initialHash = inserted[0].memory.bodyMdHash;
    expect(initialHash).toHaveLength(64);

    const items = inserted[0].memory.outstandingItems;
    expect(items).toHaveLength(2);
    const itemA = items[0]!;
    const itemB = items[1]!;

    // ── Step 1: resolve item A. New body_md → new hash.
    const resolveA = await markOutstandingResolved(memoryId, itemA.id, "did A", "agent");
    expect(resolveA.ok).toBe(true);
    if (!resolveA.ok) throw new Error("unreachable");
    const hashAfterA = resolveA.memory.bodyMdHash;
    expect(hashAfterA).not.toBe(initialHash);

    // ── Step 2: resolve item B. New body_md → newer hash.
    const resolveB = await markOutstandingResolved(memoryId, itemB.id, "did B", "agent");
    expect(resolveB.ok).toBe(true);
    if (!resolveB.ok) throw new Error("unreachable");
    const hashAfterAB = resolveB.memory.bodyMdHash;
    expect(hashAfterAB).not.toBe(hashAfterA);
    expect(hashAfterAB).not.toBe(initialHash);

    // ── Step 3: fresh updateEmbedding for the current (AB) state — succeeds.
    const freshEmbedding = randVector(EMBEDDING_DIM, "fresh");
    const okFresh = await updateEmbedding(
      memoryId,
      freshEmbedding,
      "model-fresh", // distinct from stale (step 4) so the final row's
      EMBEDDING_DIM, // embedding_model column proves which write landed.
      hashAfterAB,
    );
    expect(okFresh).toBe(true);

    // ── Step 4: stale updateEmbedding — computed against the just-A state.
    // The WHERE clause must reject this; the row keeps its fresh write.
    const staleEmbedding = randVector(EMBEDDING_DIM, "stale");
    const okStale = await updateEmbedding(
      memoryId,
      staleEmbedding,
      "model-stale",
      EMBEDDING_DIM,
      hashAfterA, // ← stale: belongs to the just-A body, not the current AB body
    );
    expect(okStale).toBe(false);

    // ── Step 5: row keeps the fresh embedding_model — stale did NOT overwrite.
    const final = await getById(memoryId);
    expect(final).not.toBeNull();
    if (!final) throw new Error("unreachable");
    expect(final.bodyMdHash).toBe(hashAfterAB);
    expect(final.embeddingModel).toBe("model-fresh");
  });

  it("succeeds when the expected hash matches the current row", async () => {
    const sid = await makeSession();

    const inserted = await insertMemories([
      newMemoryWithOutstanding(sid, ["singleton item"]),
    ]);
    const memoryId = inserted[0].memory.id;
    const initialHash = inserted[0].memory.bodyMdHash;

    const freshEmbedding = randVector(EMBEDDING_DIM, "match-fresh");
    const ok = await updateEmbedding(
      memoryId,
      freshEmbedding,
      "model-match",
      EMBEDDING_DIM,
      initialHash,
    );
    expect(ok).toBe(true);

    const final = await getById(memoryId);
    expect(final?.embeddingModel).toBe("model-match");
  });
});
