/**
 * Retrieval metadata for Polymarket gamma tag tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_TAGS_DISCOVERY = {
  // ── Tags (7) ──────────────────────────────────────────────────

  "polymarket.gamma.tags": {
    embeddingText: embeddingText(
      `List the full taxonomy of tags (categories) on Polymarket — a prediction market on Polygon — with pagination, sorting, and an optional carousel-only filter. ` +
      `Use this when the user wants to discover what categories exist on polymarket, find a tag id to filter events or markets by, list carousel (front-page) tags, or build a category browser. ` +
      `Example queries: list polymarket categories, what tags exist on polymarket, show carousel tags, browse polymarket tag taxonomy, find tag id for crypto. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket tags", "categories",
      "tag id", "carousel tag",
      "tag taxonomy",
    ],
    exampleIntents: [
      "list polymarket categories",
      "show carousel tags",
      "browse polymarket tag taxonomy",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.tag": {
    embeddingText: embeddingText(
      `Get a single tag (category) by numeric ID on Polymarket — a prediction market on Polygon — returning label, slug, carousel flag, and template data. ` +
      `Use this when the user already has a tag id and wants its full record, or when expanding a tag id surfaced by another tool. Pick the by-id variant over the by-slug sibling when the input is a numeric tag id. ` +
      `Example queries: get polymarket tag 42, fetch this tag by id, expand tag id, look up tag details by id. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket tag", "get tag",
      "tag by id", "tag id",
      "carousel tag",
    ],
    exampleIntents: [
      "get polymarket tag by id",
      "fetch this tag by id 42",
      "expand tag id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.tagBySlug": {
    embeddingText: embeddingText(
      `Get a single tag (category) by slug on Polymarket — a prediction market on Polygon — returning numeric ID, label, carousel flag, and template data. ` +
      `Use this when the user references a tag by its human-readable slug like "crypto" or "sports" rather than a numeric id — slug-shaped inputs route here over the by-id sibling, and this is the natural way to resolve a category name to its tag id. ` +
      `Example queries: get polymarket tag by slug, look up crypto tag, resolve sports slug to tag id, fetch this category by name. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket tag", "tag by slug",
      "by slug", "tag slug", "category slug",
    ],
    exampleIntents: [
      "get polymarket tag by slug",
      "look up crypto tag",
      "resolve sports slug to tag id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.relatedTags": {
    embeddingText: embeddingText(
      `Get the IDs of tags related to a given tag on Polymarket — a prediction market on Polygon — by numeric tag id, with active/closed/all status filtering. Returns just the related tag IDs, not the full tag objects. ` +
      `Use this when the user has a tag id and wants the lightweight list of nearby category ids for navigation, breadcrumbs, or a related-categories rail. Pick the by-id variant over the by-slug sibling when the input is a numeric tag id; pick this over tagsRelatedToTag when only the IDs are needed. ` +
      `Example queries: related tag ids for tag 42, nearby tags for this category by id, lightweight related tags. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "related tags", "nearby tags",
      "tag id", "by id",
    ],
    exampleIntents: [
      "related tag ids for tag 42",
      "nearby tags for this category by id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.relatedTagsBySlug": {
    embeddingText: embeddingText(
      `Get the IDs of tags related to a given tag on Polymarket — a prediction market on Polygon — by tag slug, with active/closed/all status filtering. Returns just the related tag IDs, not the full tag objects. ` +
      `Use this when the user references a category by slug like "crypto" or "sports" — slug-shaped inputs route here over the by-id sibling — and only needs the lightweight list of nearby tag ids for navigation or related-categories rails. ` +
      `Example queries: related tag ids for crypto slug, nearby tags by slug, lightweight related categories by slug. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "related tags", "nearby tags",
      "by slug", "tag slug",
    ],
    exampleIntents: [
      "related tag ids for crypto slug",
      "nearby tags by slug",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.tagsRelatedToTag": {
    embeddingText: embeddingText(
      `Get the full tag objects (label, slug, carousel flag, template) for tags related to a given tag on Polymarket — a prediction market on Polygon — by numeric tag id, with active/closed/all status filtering. ` +
      `Use this when the user wants a fully-rendered list of related categories rather than just IDs. Pick the by-id variant over the by-slug sibling when the input is a numeric tag id; pick this over relatedTags when the consumer needs the full tag payload. ` +
      `Example queries: full related tags for tag 42, expand related categories by id, related tag objects. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "related tags", "tag objects",
      "tag id", "by id",
    ],
    exampleIntents: [
      "full related tags for tag 42",
      "expand related categories by id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.tagsRelatedToTagBySlug": {
    embeddingText: embeddingText(
      `Get the full tag objects (label, slug, carousel flag, template) for tags related to a given tag on Polymarket — a prediction market on Polygon — by tag slug, with active/closed/all status filtering. ` +
      `Use this when the user references a category by slug like "crypto" or "sports" — slug-shaped inputs route here over the by-id sibling — and wants a fully-rendered list of related categories rather than just IDs. ` +
      `Example queries: full related tags for crypto slug, expand related categories by slug, related tag objects by slug. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "related tags", "tag objects",
      "by slug", "tag slug",
    ],
    exampleIntents: [
      "full related tags for crypto slug",
      "expand related categories by slug",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
