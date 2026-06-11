/**
 * Integration: knowledge_entries.source field gates Active Memory.
 *
 * Proofs:
 *   - `listActiveForHotContext` returns only rows with source ∈
 *     ('observed','user_confirmed'). `inferred` and `hypothesis` entries are
 *     excluded.
 *   - `listKnownKinds` aggregation respects the same filter.
 *   - `countActiveHotContextEntries` matches the hot-context filter exactly.
 *   - Default source on insert is 'observed' (backfill safety).
 */

import { describe, it, expect, beforeEach } from "vitest";

import {
  insertEntry,
  listActiveForHotContext,
  listKnownKinds,
  countActiveHotContextEntries,
  findByContentHash,
  type InsertEntryInput,
} from "@vex-agent/db/repos/knowledge.js";
import { computeContentHash } from "@vex-agent/knowledge/content-hash.js";
import { randVector, resetDb } from "../setup/fixtures.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";

const EMBEDDING_MODEL = "test-model";
const EMBEDDING_DIM = 8;

function newEntry(
  kind: string,
  title: string,
  source: KnowledgeSource | undefined,
  summary = "summary",
  contentMd = "content"
): InsertEntryInput {
  const hash = computeContentHash({ kind, title, summary, contentMd });
  return {
    kind,
    title,
    summary,
    contentMd,
    tags: [],
    sourceRefs: {},
    confidence: 0.9,
    pinned: false,
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    contentHash: hash,
    embeddingModel: EMBEDDING_MODEL,
    embeddingDim: EMBEDDING_DIM,
    embedding: randVector(EMBEDDING_DIM, hash),
    ...(source !== undefined ? { source } : {}),
  };
}

describe("knowledge source filtering for hot context (integration)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("listActiveForHotContext excludes inferred and hypothesis entries", async () => {
    await insertEntry(newEntry("trading_rule", "Observed pattern", "observed"));
    await insertEntry(newEntry("trading_rule", "Confirmed by user", "user_confirmed"));
    await insertEntry(newEntry("trading_rule", "Inferred hypothesis", "inferred"));
    await insertEntry(newEntry("trading_rule", "Pure guess", "hypothesis"));

    const hot = await listActiveForHotContext({ limit: 50 });
    const titles = hot.map((e) => e.title);
    expect(titles).toContain("Observed pattern");
    expect(titles).toContain("Confirmed by user");
    expect(titles).not.toContain("Inferred hypothesis");
    expect(titles).not.toContain("Pure guess");
  });

  it("listKnownKinds counts only hot-context sources", async () => {
    await insertEntry(newEntry("strategy", "Observed A", "observed"));
    await insertEntry(newEntry("strategy", "Inferred B", "inferred"));
    await insertEntry(newEntry("strategy", "Hypothesis C", "hypothesis"));

    const kinds = await listKnownKinds({ limit: 10 });
    const strategy = kinds.find((k) => k.kind === "strategy");
    expect(strategy).toBeDefined();
    expect(strategy?.count).toBe(1);
  });

  it("countActiveHotContextEntries matches the filter exactly", async () => {
    await insertEntry(newEntry("k1", "A", "observed"));
    await insertEntry(newEntry("k2", "B", "user_confirmed"));
    await insertEntry(newEntry("k3", "C", "inferred"));
    await insertEntry(newEntry("k4", "D", "hypothesis"));
    const n = await countActiveHotContextEntries();
    expect(n).toBe(2);
  });

  it("defaults source to 'observed' when caller omits it", async () => {
    const input = newEntry("legacy_kind", "Legacy entry no source", undefined);
    await insertEntry(input);
    const e = await findByContentHash(input.contentHash);
    expect(e).not.toBeNull();
    expect(e?.source).toBe("observed");

    const hot = await listActiveForHotContext({ limit: 10 });
    expect(hot.map((x) => x.title)).toContain("Legacy entry no source");
  });

  it("inferred entry is still recallable via direct DB query but not in hot context", async () => {
    const input = newEntry("inferred_only", "Inferred Title", "inferred");
    await insertEntry(input);
    const e = await findByContentHash(input.contentHash);
    expect(e).not.toBeNull();
    expect(e?.source).toBe("inferred");

    const hot = await listActiveForHotContext({ limit: 50 });
    expect(hot.map((x) => x.title)).not.toContain("Inferred Title");
  });
});
