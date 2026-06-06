/**
 * Retrieval metadata for Polymarket gamma comment tools.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_COMMENTS_DISCOVERY = {
  // ── Comments (3) ──────────────────────────────────────────────

  "polymarket.gamma.comments": {
    embeddingText: embeddingText(
      `Browse comments on Polymarket — a prediction market on Polygon — filtered by parent entity type (Event / Series / market) and entity ID, with an optional holders-only filter and position-data join. ` +
      `Use this when the user wants to read what people are saying about a market or event, gauge sentiment from token holders, or pull comments on this market for analysis. ` +
      `Example queries: comments on this market, polymarket discussion for event 12345, holder-only comments, sentiment on this prediction market. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket comments", "comments on this market",
      "discussion", "holder comments",
      "sentiment",
    ],
    exampleIntents: [
      "comments on this polymarket market",
      "polymarket discussion for event 12345",
      "holder-only comments on this market",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.comment": {
    embeddingText: embeddingText(
      `Get a single comment by ID on Polymarket — a prediction market on Polygon — with optional position-data join for the author. ` +
      `Use this when the user references a specific polymarket comment id and wants its full record, e.g. to expand a deep-link or show one quoted comment. ` +
      `Example queries: get polymarket comment 789, expand this comment by id, fetch comment details. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket comment", "get comment",
      "comment by id", "by id",
    ],
    exampleIntents: [
      "get polymarket comment by id",
      "expand this comment by id",
    ],
    chains: POLYMARKET_CHAINS,
  },

  "polymarket.gamma.commentsByUser": {
    embeddingText: embeddingText(
      `Get all comments authored by one wallet address on Polymarket — a prediction market on Polygon — with pagination and sorting. ` +
      `Use this when the user wants to see everything a polymarket user has said, audit a trader's commentary across markets, or pull a profile-style comment feed for one address. ` +
      `Example queries: comments by this polymarket user, what has 0x1234 said on polymarket, polymarket comment history for this address. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "user comments", "comments by user",
      "comment history", "polymarket profile",
    ],
    exampleIntents: [
      "comments by this polymarket user",
      "what has this address said on polymarket",
      "polymarket comment history for 0x1234",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
