/**
 * PR5 — concurrent-insert race regression for `insertPreparedMemory`.
 *
 * Before PR5, the upsert used `INSERT ... ON CONFLICT DO NOTHING + WITH
 * UNION ALL fallback`. Under READ COMMITTED that pattern could return
 * zero rows when two transactions raced on the same content_hash: the
 * second transaction's conflict-skipped INSERT left an empty CTE, AND
 * the UNION ALL fallback's SELECT could fire BEFORE the winning
 * transaction committed, so the existing row wasn't visible. Result:
 * `queryOneWith` returned null and the caller threw "upsert returned
 * no row".
 *
 * PR5 fix: switch to `ON CONFLICT DO UPDATE SET updated_at =
 * session_memories.updated_at RETURNING *, (xmax = 0) AS inserted`.
 * A no-op UPDATE always emits a row in RETURNING, and the system
 * column `xmax` distinguishes freshly-inserted (xmax=0) from
 * conflict-merged rows.
 *
 * This test fires two `insertPreparedMemory` calls in parallel with
 * identical content (same session_id + content_hash). Without the
 * fix, occasional flakes manifest as "upsert returned no row" thrown
 * by one of the two calls.
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  insertPreparedMemory,
  prepareMemoryRender,
  type NewSessionMemory,
} from "@vex-agent/db/repos/session-memories/index.js";
import { makeSession, randVector, resetDb } from "../setup/fixtures.js";

const EMBEDDING_DIM = 8;
const TEST_EMBEDDING_MODEL = "test-model";

function newRowInput(sessionId: string): NewSessionMemory {
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
    happenedMd: "concurrent insert race fixture happened",
    didMd: "concurrent insert race fixture did",
    triedMd: "concurrent insert race fixture tried",
    outstandingTexts: [],
    sourceStartMessageId: null,
    sourceEndMessageId: null,
    inferenceModel: "test-llm",
    embeddingModel: TEST_EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    embedding: randVector(EMBEDDING_DIM, "race-content-fixed-seed"),
  };
}

describe("insertPreparedMemory concurrent same-hash insert (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("two parallel calls with identical content both return — one inserted, one merged", async () => {
    const sid = await makeSession();

    // Same input → same content_hash → same `body_md_hash`. Two parallel
    // inserts must both resolve to a non-null result.
    const input = newRowInput(sid);
    const prep = prepareMemoryRender({
      theme: input.theme,
      happenedMd: input.happenedMd,
      didMd: input.didMd,
      triedMd: input.triedMd,
      outstandingTexts: input.outstandingTexts,
    });

    const [a, b] = await Promise.all([
      insertPreparedMemory(input, prep),
      insertPreparedMemory(input, prep),
    ]);

    // Neither call threw (the regression manifested as "upsert returned no
    // row"). Both got a real memory back.
    expect(a.memory.id).toBeGreaterThan(0);
    expect(b.memory.id).toBeGreaterThan(0);

    // Both reference the SAME row — the partial unique on (session_id,
    // content_hash) WHERE status='active' guarantees one canonical row.
    expect(a.memory.id).toBe(b.memory.id);

    // Exactly one call observed the fresh INSERT (xmax = 0); the other
    // observed the conflict-merge (xmax != 0). The pair must total to one
    // truthy inserted flag — never both true, never both false.
    const insertedCount = [a.inserted, b.inserted].filter(Boolean).length;
    expect(insertedCount).toBe(1);
  });

  it("sequential calls — first is inserted, second is merged", async () => {
    const sid = await makeSession();
    const input = newRowInput(sid);
    const prep = prepareMemoryRender({
      theme: input.theme,
      happenedMd: input.happenedMd,
      didMd: input.didMd,
      triedMd: input.triedMd,
      outstandingTexts: input.outstandingTexts,
    });

    const a = await insertPreparedMemory(input, prep);
    const b = await insertPreparedMemory(input, prep);

    expect(a.inserted).toBe(true);
    expect(b.inserted).toBe(false);
    expect(a.memory.id).toBe(b.memory.id);
  });
});
