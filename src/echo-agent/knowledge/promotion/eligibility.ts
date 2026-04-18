/**
 * Promotion eligibility + cluster signal.
 *
 * Thin wrappers over the read-only queries in
 * `db/repos/session-episodes/promotion-queries.ts`. Split from the
 * orchestrator so the gating policy (similarity threshold, min-similar
 * count, candidate cap) is named in one place and the orchestrator just
 * asks "is this candidate promotable?".
 */

import {
  countSimilar,
  listPromotable,
  type PromotionCandidate,
} from "@echo-agent/db/repos/session-episodes.js";

// ── Tunables ─────────────────────────────────────────────────────────

export const DEFAULT_SIMILARITY_THRESHOLD = 0.85;
export const DEFAULT_MIN_SIMILAR = 2;
export const DEFAULT_MAX_CANDIDATES = 20;

export function envNumber(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// ── Listing ──────────────────────────────────────────────────────────

/**
 * Fetch candidate episodes for promotion, honouring the env-configurable
 * `PROMOTION_MAX_CANDIDATES` cap.
 */
export async function listPromotionCandidates(
  scopeKey: string,
): Promise<PromotionCandidate[]> {
  return listPromotable(
    scopeKey,
    envNumber("PROMOTION_MAX_CANDIDATES", DEFAULT_MAX_CANDIDATES),
  );
}

// ── Cluster signal ───────────────────────────────────────────────────

/**
 * True if the candidate has at least `PROMOTION_MIN_SIMILAR` OTHER
 * episodes in the same scope + kind with cosine similarity ≥
 * `PROMOTION_SIMILARITY_THRESHOLD`. Excludes the candidate itself.
 *
 * Represents the "repeated observation" signal — a one-off assertion
 * does NOT promote, a recurring one does.
 */
export async function hasEnoughSimilar(
  candidate: PromotionCandidate,
): Promise<boolean> {
  const threshold = envNumber(
    "PROMOTION_SIMILARITY_THRESHOLD",
    DEFAULT_SIMILARITY_THRESHOLD,
  );
  const minSimilar = envNumber("PROMOTION_MIN_SIMILAR", DEFAULT_MIN_SIMILAR);

  const similar = await countSimilar(
    candidate.id,
    candidate.memoryScopeKey,
    candidate.episodeKind,
    candidate.embedding,
    candidate.embeddingModel,
    threshold,
  );
  return similar >= minSimilar;
}
