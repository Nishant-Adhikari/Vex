/**
 * episode → knowledge promotion pipeline — public orchestrator.
 *
 * Elevates repeated session episodes into the canonical `knowledge_entries`
 * layer so they survive session deletion and cross-session recall. The
 * orchestrator here composes the per-stage modules split out in PR2:
 *
 *   - `promotion/eligibility.ts` — candidate listing + cluster-signal gate.
 *   - `promotion/translation.ts` — non-EN → English on the way into canonical.
 *   - `promotion/persist.ts`     — the single lease-gated `insertEntry`.
 *
 * Decision flow for each candidate (unchanged from pre-split):
 *
 *   1. Scope-local candidate list (eligibility): kind in
 *      {decision, preference, lesson, fact}, has `source_end_message_id`,
 *      not already promoted.
 *   2. Cluster signal: require ≥ `PROMOTION_MIN_SIMILAR` OTHER episodes in
 *      the same scope + kind with cosine ≥ `PROMOTION_SIMILARITY_THRESHOLD`.
 *   3. Language gate: read `sessions.memory_language_code`. `en` inserts
 *      as-is; a known non-EN code goes through translation; `null` / `und`
 *      skips with `language_unknown` (fail-closed).
 *   4. Re-embed against the English payload, then INSERT through
 *      `withLeaseSharedLock`. Three idempotency layers catch duplicates.
 *
 * Best-effort: errors never crash the caller (turn-loop). Skip reasons
 * surface via `logger.warn` with structured fields so an operator can
 * count `language_unknown` / `translation_failed` / `not_enough_similar`
 * / `maintenance_active` over time.
 */

import pg from "pg";

import type { KnowledgeEntry } from "@echo-agent/db/repos/knowledge.js";
import { MaintenanceActiveError } from "@echo-agent/db/repos/maintenance-lease.js";
import type { PromotionCandidate } from "@echo-agent/db/repos/session-episodes.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import { embedDocument } from "@echo-agent/embeddings/client.js";
import { loadEmbeddingConfig } from "@echo-agent/embeddings/config.js";
import type {
  InferenceConfig,
  InferenceProvider,
} from "@echo-agent/inference/types.js";
import logger from "@utils/logger.js";

import {
  hasEnoughSimilar,
  listPromotionCandidates,
} from "./promotion/eligibility.js";
import { persistPromotedEntry } from "./promotion/persist.js";
import { translateEpisodeToEnglish } from "./promotion/translation.js";

// ── Public result shape ─────────────────────────────────────────────

export type PromotionOutcome =
  | { code: "inserted"; entry: KnowledgeEntry }
  | { code: "already_promoted"; reason: "source_episode_id" | "content_hash" | "source_episode_hash" }
  | {
      code: "skipped";
      reason:
        | "not_enough_similar"
        | "language_unknown"
        | "translation_failed"
        | "invariant_violated"
        | "embedding_unavailable"
        | "maintenance_active";
    };

export interface PromotionRunReport {
  sessionId: string;
  scopeKey: string;
  considered: number;
  inserted: number;
  alreadyPromoted: number;
  skipped: Record<string, number>;
}

// ── Entry point ─────────────────────────────────────────────────────

/**
 * Run the promotion pipeline for a session. Intended to be called from
 * `turn-loop.ts` in an OUTER try/catch AFTER `executeCheckpoint` has
 * committed — never inside the checkpoint tx.
 */
export async function runPromotionForSession(
  sessionId: string,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<PromotionRunReport> {
  const session = await sessionsRepo.getSession(sessionId);
  const scopeKey = session?.memoryScopeKey ?? sessionId;
  const report: PromotionRunReport = {
    sessionId,
    scopeKey,
    considered: 0,
    inserted: 0,
    alreadyPromoted: 0,
    skipped: {},
  };

  const candidates = await listPromotionCandidates(scopeKey);
  report.considered = candidates.length;
  if (candidates.length === 0) {
    logger.info("promotion.run.no_candidates", { sessionId, scopeKey });
    return report;
  }

  for (const candidate of candidates) {
    const outcome = await promoteEpisode(candidate, provider, config);
    switch (outcome.code) {
      case "inserted":
        report.inserted++;
        logger.info("promotion.promoted", {
          sessionId,
          scopeKey,
          episodeId: candidate.id,
          episodeKind: candidate.episodeKind,
          knowledgeEntryId: outcome.entry.id,
        });
        break;
      case "already_promoted":
        report.alreadyPromoted++;
        logger.info("promotion.already_promoted", {
          sessionId,
          scopeKey,
          episodeId: candidate.id,
          reason: outcome.reason,
        });
        break;
      case "skipped": {
        const count = report.skipped[outcome.reason] ?? 0;
        report.skipped[outcome.reason] = count + 1;
        logger.warn("promotion.skipped", {
          sessionId,
          scopeKey,
          episodeId: candidate.id,
          reason: outcome.reason,
        });
        break;
      }
    }
  }

  logger.info("promotion.run.completed", report);
  return report;
}

// ── Core promotion logic ────────────────────────────────────────────

async function promoteEpisode(
  candidate: PromotionCandidate,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<PromotionOutcome> {
  // Invariant: `listPromotionCandidates` already filters on
  // `source_end_message_id`; this is a belt-and-braces guard.
  if (candidate.sourceEndMessageId === null) {
    return { code: "skipped", reason: "invariant_violated" };
  }

  // Cluster signal — promote only when the same kind recurs in the scope.
  if (!(await hasEnoughSimilar(candidate))) {
    return { code: "skipped", reason: "not_enough_similar" };
  }

  // Language gate. `sessions.memory_language_code` is the only source of
  // truth — no text heuristic. If we can't read it, fail-closed: skip.
  const sourceSessionId = candidate.sourceSession ?? candidate.sessionId;
  const langCode = await sessionsRepo.getMemoryLanguageCode(sourceSessionId);

  let englishTitle = candidate.title;
  let englishSummary = candidate.summaryText;
  if (langCode === null || langCode === "und") {
    return { code: "skipped", reason: "language_unknown" };
  }
  if (langCode !== "en") {
    try {
      const translated = await translateEpisodeToEnglish(
        candidate.title,
        candidate.summaryText,
        langCode,
        provider,
        config,
      );
      englishTitle = translated.title;
      englishSummary = translated.summary;
    } catch (err) {
      logger.warn("promotion.translate_failed", {
        episodeId: candidate.id,
        langCode,
        error: err instanceof Error ? err.message : String(err),
      });
      return { code: "skipped", reason: "translation_failed" };
    }
  }

  // Re-embed against the English payload so recall filters stay clean.
  // If embeddings are down we skip — we'd rather wait than insert with
  // the session-language embedding into the English layer.
  let embedding: number[];
  let providerModel: string;
  let embeddingDim: number;
  try {
    const titleForEmbed =
      englishTitle.trim().length > 0
        ? englishTitle
        : englishSummary.slice(0, 120);
    const embedCfg = loadEmbeddingConfig();
    const result = await embedDocument(titleForEmbed, englishSummary, embedCfg);
    embedding = result.embedding;
    providerModel = result.providerModel;
    embeddingDim = embedding.length;
  } catch (err) {
    logger.warn("promotion.embed_failed", {
      episodeId: candidate.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return { code: "skipped", reason: "embedding_unavailable" };
  }

  // Persist under the maintenance-lease SHARE lock. All three idempotency
  // layers (source_episode_id / source_episode_hash / content_hash) can
  // reject; surface each as a stable `already_promoted` outcome.
  try {
    const { entry, inserted } = await persistPromotedEntry({
      episodeId: candidate.id,
      episodeKind: candidate.episodeKind,
      episodeHash: candidate.episodeHash,
      sourceSessionId,
      englishTitle,
      englishSummary,
      embedding,
      embeddingModel: providerModel,
      embeddingDim,
    });
    if (!inserted) {
      return { code: "already_promoted", reason: "content_hash" };
    }
    return { code: "inserted", entry };
  } catch (err) {
    // 23505 on the two promotion-specific indexes = silent "already
    // promoted" (race-lost). Anything else surfaces — caller logs it.
    if (err instanceof pg.DatabaseError && err.code === "23505") {
      const constraint = err.constraint ?? "";
      if (constraint === "idx_ke_source_episode_id") {
        return { code: "already_promoted", reason: "source_episode_id" };
      }
      if (constraint === "idx_ke_source_episode_hash") {
        return { code: "already_promoted", reason: "source_episode_hash" };
      }
    }
    if (err instanceof MaintenanceActiveError) {
      // Maintenance running — defer; don't poison the pipeline with a
      // partial promotion batch. Reported under a dedicated reason so
      // operators can distinguish reembed contention from a real
      // embed-sidecar outage in `report.skipped`.
      logger.warn("promotion.maintenance_active", {
        episodeId: candidate.id,
        ownerId: err.ownerId,
      });
      return { code: "skipped", reason: "maintenance_active" };
    }
    throw err;
  }
}
