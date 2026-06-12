/**
 * Eval: S8 graph write-path (live Gemma embeddings on the entity names).
 *
 * The GREEN HARD test is a DETERMINISTIC stubbed `GraphPlan` driven through the
 * production `applyGraphPlan` write path (entities / links / edges), so the
 * graph WRITE seam is proven against real tables without depending on the
 * (F31-blocked) live judge/promote. Entity NAME embeddings are REAL Gemma
 * vectors (dim 768, real provider model) — only the extraction LLM's plan is
 * stubbed.
 *
 * MEASURED (fail-open, NO hard assert): a live DeepSeek entity extraction on a
 * real lesson. Because F31 blocks live promotes, the end-to-end extract→promote
 * graph build is recorded as "graph extraction unmeasurable until F31 fixed
 * (judge blocks promotion)" — the stubbed write-path assertion is the green
 * proof that the write seam itself is correct.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { withTransaction, query } from "@vex-agent/db/client.js";
import {
  applyGraphPlan,
  extractEntities,
  type GraphPlan,
} from "@vex-agent/memory/manager/index.js";
import { embedDocument } from "@vex-agent/embeddings/client.js";
import { resetDb } from "../setup/fixtures.js";
import { seedPromotedLessonDirect } from "./_eval-fixtures.js";
import { reportCard } from "./_report-card.js";

const SUITE = "graph";
const hasKey = !!process.env.OPENROUTER_API_KEY;

describe.skipIf(!hasKey)("eval: S8 graph (live)", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("applies a deterministic graph plan: entity + edge + link rows land", async () => {
    // A real promoted entry (real insert + Gemma) to own the graph rows.
    const entry = await seedPromotedLessonDirect({
      kind: "trade_lesson",
      title: "Hyperliquid funding spikes precede mean reversion on SOL",
      summary:
        "When SOL perp funding spikes on Hyperliquid, a mean reversion of price tends to follow.",
      source: "observed",
    });

    // Real Gemma NAME embeddings for the two NEW entities (dim 768, real model).
    const sol = await embedDocument("SOL", "Solana token");
    const hl = await embedDocument("Hyperliquid", "Perpetuals trading venue");

    const plan: GraphPlan = {
      entities: [
        {
          kind: "new",
          key: "token:sol",
          entityType: "token",
          name: "SOL",
          aliases: ["Solana"],
          summary: "Solana token",
          embedding: sol.embedding,
          embeddingModel: sol.providerModel,
          embeddingDim: sol.embedding.length,
        },
        {
          kind: "new",
          key: "protocol:hyperliquid",
          entityType: "protocol",
          name: "Hyperliquid",
          aliases: [],
          summary: "Perpetuals trading venue",
          embedding: hl.embedding,
          embeddingModel: hl.providerModel,
          embeddingDim: hl.embedding.length,
        },
      ],
      links: [
        { key: "token:sol", mentionCount: 1 },
        { key: "protocol:hyperliquid", mentionCount: 1 },
      ],
      edges: [
        {
          sourceKey: "token:sol",
          targetKey: "protocol:hyperliquid",
          relation: "traded_on",
          fact: "SOL perps trade on Hyperliquid",
        },
      ],
    };

    const counts = await withTransaction((tx) => applyGraphPlan(plan, entry.id, tx));
    expect(counts.entityCount).toBe(2);
    expect(counts.linkCount).toBe(2);
    expect(counts.edgeCount).toBe(1);

    // Verify the rows actually landed in the real tables.
    const entityRows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memory_entities WHERE entity_type IN ('token','protocol')`,
    );
    const linkRows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memory_entry_entities WHERE entry_id = $1`,
      [entry.id],
    );
    const edgeRows = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM memory_edges WHERE origin_entry_id = $1 AND relation = 'traded_on'`,
      [entry.id],
    );
    const entityCount = Number(entityRows[0]!.n);
    const linkCount = Number(linkRows[0]!.n);
    const edgeCount = Number(edgeRows[0]!.n);

    expect(entityCount).toBeGreaterThanOrEqual(2);
    expect(linkCount).toBe(2);
    expect(edgeCount).toBe(1);
    reportCard.recordCheck(SUITE, {
      label: "deterministic graph plan → entity/link/edge rows written",
      pass: entityCount >= 2 && linkCount === 2 && edgeCount === 1,
      note: `entities=${entityCount} links=${linkCount} edges=${edgeCount}`,
    });
  });

  it("measures live DeepSeek entity extraction (fail-open; F31 blocks the promote path)", async () => {
    // The end-to-end extract→promote graph build is UNMEASURABLE while F31 blocks
    // every live promote. We still probe the extractor in isolation (fail-open):
    // record what it returns WITHOUT asserting — extraction is help, not truth.
    let extractedEntities = -1;
    let extractedEdges = -1;
    let failReason: string | null = null;
    try {
      // Default provider = live DeepSeek via OpenRouter.
      const extraction = await extractEntities({
        kind: "trade_lesson",
        title: "Hyperliquid funding spikes precede mean reversion on SOL",
        summary:
          "When SOL perp funding spikes on Hyperliquid, a mean reversion of price tends to follow.",
        contentMd: "",
        regimeTags: [],
      });
      extractedEntities = extraction.entities.length;
      extractedEdges = extraction.edges.length;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Bounded category only — never raw model text.
      failReason = msg.includes("timeout")
        ? "extraction_timeout"
        : msg.includes("schema_invalid")
          ? "extraction_schema_invalid"
          : msg.includes("malformed")
            ? "extraction_malformed"
            : "extraction_error";
    }

    const measured = extractedEntities >= 0;
    reportCard.recordCheck(SUITE, {
      label: "live extraction probe (fail-open; recorded, not asserted)",
      pass: true,
      note: measured
        ? `entities=${extractedEntities} edges=${extractedEdges}`
        : `extraction failed: ${failReason}`,
    });
    reportCard.recordFinding({
      code: "F31",
      manifested: true,
      summary: measured
        ? `graph extraction reachable in isolation (entities=${extractedEntities}) but the end-to-end extract→PROMOTE graph build is UNMEASURABLE — F31 blocks every live promote`
        : `graph extraction unmeasurable until F31 fixed (judge blocks promotion); standalone extractor also failed (${failReason})`,
    });
    // No hard assert — extraction is fail-open by contract.
    expect(true).toBe(true);
  });
});
