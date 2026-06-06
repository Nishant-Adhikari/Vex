/**
 * Gamma-DISCOVERY FAÇADE surface guard (A-039 structural split).
 *
 * `src/vex-agent/tools/protocols/embeddings/polymarket/gamma.ts` was split into
 * per-resource discovery chunk modules under `./gamma/` (events / markets /
 * search / tags / series / comments / profile / sports), mirroring the A-037
 * manifest grouping, while the original path stays a compatibility façade that
 * re-assembles the SAME `POLYMARKET_GAMMA_DISCOVERY` object.
 *
 * The manifest references each entry by `toolId` key, so the key set and order
 * of the re-assembled object are the observable surface. This test pins the
 * EXACT `Object.keys(...)` sequence so a later edit cannot silently drop,
 * reorder, rename, or add a discovery entry. The passage-shape rules are
 * covered by `embedding-lint.test.ts`; here we only assert the ordered key
 * surface and a verbatim-move spot check.
 */

import { describe, it, expect } from "vitest";

import { POLYMARKET_GAMMA_DISCOVERY } from "@vex-agent/tools/protocols/embeddings/polymarket/gamma.js";

// EXACT original key order (top-to-bottom of the pre-split god-file).
const EXPECTED_KEYS = [
  // ── Events (4) ──
  "polymarket.gamma.events",
  "polymarket.gamma.event",
  "polymarket.gamma.eventBySlug",
  "polymarket.gamma.eventTags",
  // ── Markets (4) ──
  "polymarket.gamma.markets",
  "polymarket.gamma.market",
  "polymarket.gamma.marketBySlug",
  "polymarket.gamma.marketTags",
  // ── Search (1) ──
  "polymarket.gamma.search",
  // ── Tags (7) ──
  "polymarket.gamma.tags",
  "polymarket.gamma.tag",
  "polymarket.gamma.tagBySlug",
  "polymarket.gamma.relatedTags",
  "polymarket.gamma.relatedTagsBySlug",
  "polymarket.gamma.tagsRelatedToTag",
  "polymarket.gamma.tagsRelatedToTagBySlug",
  // ── Series (2) ──
  "polymarket.gamma.series",
  "polymarket.gamma.seriesById",
  // ── Comments (3) ──
  "polymarket.gamma.comments",
  "polymarket.gamma.comment",
  "polymarket.gamma.commentsByUser",
  // ── Profiles (1) ──
  "polymarket.gamma.profile",
  // ── Sports (3) ──
  "polymarket.gamma.sportsMetadata",
  "polymarket.gamma.sportsMarketTypes",
  "polymarket.gamma.teams",
] as const;

describe("POLYMARKET_GAMMA_DISCOVERY façade — ordered key surface (A-039 split pin)", () => {
  it("re-assembles the EXACT ordered key sequence", () => {
    expect(Object.keys(POLYMARKET_GAMMA_DISCOVERY)).toEqual([...EXPECTED_KEYS]);
  });

  it("has no duplicate keys", () => {
    const keys = Object.keys(POLYMARKET_GAMMA_DISCOVERY);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("count matches the pinned surface", () => {
    expect(Object.keys(POLYMARKET_GAMMA_DISCOVERY)).toHaveLength(EXPECTED_KEYS.length);
  });

  it("every entry carries an embeddingText passage (verbatim move check)", () => {
    for (const key of EXPECTED_KEYS) {
      const entry = POLYMARKET_GAMMA_DISCOVERY[key];
      expect(entry).toBeDefined();
      expect(typeof entry.embeddingText).toBe("string");
      expect(entry.embeddingText.length).toBeGreaterThan(0);
    }
  });
});
