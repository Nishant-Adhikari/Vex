/**
 * Retrieval metadata for the Polymarket gamma profile tool.
 *
 * Source-of-truth for both the lexical scorer (`discovery.ts`) and the
 * future dense-retrieval pipeline (EmbeddingGemma 300M → pgvector). Manifest
 * at `polymarket/manifests/gamma.ts` references entries by `toolId`.
 */

import type { ToolDiscoveryMetadata } from "../../../types.js";
import { embeddingText } from "../../../_embedding-text.js";
import { POLYMARKET_CHAINS } from "../../../polymarket/discovery-text.js";

export const POLYMARKET_GAMMA_PROFILE_DISCOVERY = {
  // ── Profiles (1) ──────────────────────────────────────────────

  "polymarket.gamma.profile": {
    embeddingText: embeddingText(
      `Get a public profile on Polymarket — a prediction market on Polygon — by wallet address. Returns display name, pseudonym, bio, X (Twitter) username, and verified-badge flag. ` +
      `Use this when the user wants to look up who an address is on polymarket, resolve a trader's display name, or pull profile metadata before showing positions or comments. ` +
      `Example queries: polymarket profile for 0x1234, who is this address on polymarket, get user display name, lookup polymarket pseudonym. ` +
      `Read-only.`,
    ),
    aliases: [
      "prediction market", "polymarket",
      "polymarket profile", "user profile",
      "display name", "pseudonym",
      "verified badge",
    ],
    exampleIntents: [
      "polymarket profile for 0x1234",
      "who is this address on polymarket",
      "get user display name on polymarket",
    ],
    chains: POLYMARKET_CHAINS,
  },
} satisfies Record<string, ToolDiscoveryMetadata>;
