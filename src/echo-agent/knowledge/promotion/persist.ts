/**
 * Promotion persistence — the single write path from session episodes
 * into `knowledge_entries`.
 *
 * Invariant (critical): this file contains the ONLY `knowledgeRepo.insertEntry`
 * call inside the `knowledge/promotion/` tree, and it runs UNDER
 * `withLeaseSharedLock`. Splitting promotion into per-stage modules (PR2)
 * must NOT cause the lease call to drift into eligibility/translation —
 * if it does, reembed races against promotion again and the whole PR4
 * maintenance-lease protection melts.
 *
 * Shape / idempotency:
 *   - `content_hash` is the legacy UNIQUE idempotency key.
 *   - `source_episode_id` + `source_episode_hash` are the promotion-specific
 *     idempotency indexes (UNIQUE). All three can race-lose; the orchestrator
 *     translates the pg constraint name into a stable `already_promoted` reason.
 *   - `source_refs.parent_session_id` carries subagent provenance up to the
 *     parent-session layer so `knowledge_entries` keeps a searchable
 *     attribution even after subagent isolation.
 */

import { createHash } from "node:crypto";

import { getPool } from "@echo-agent/db/client.js";
import * as knowledgeRepo from "@echo-agent/db/repos/knowledge.js";
import type { KnowledgeEntry } from "@echo-agent/db/repos/knowledge.js";
import { withLeaseSharedLock } from "@echo-agent/db/repos/maintenance-lease.js";
import type { EpisodeKind } from "@echo-agent/db/repos/session-episodes.js";
import * as sessionLinksRepo from "@echo-agent/db/repos/session-links.js";
import logger from "@utils/logger.js";

export const PROMOTION_VERSION = 1;

export interface PersistArgs {
  episodeId: number;
  episodeKind: EpisodeKind;
  episodeHash: string;
  sourceSessionId: string;
  englishTitle: string;
  englishSummary: string;
  embedding: number[];
  embeddingModel: string;
  embeddingDim: number;
}

export interface PersistResult {
  entry: KnowledgeEntry;
  inserted: boolean;
}

/**
 * Insert a translated + embedded candidate into `knowledge_entries`
 * through the maintenance-lease SHARE lock. Returns the resulting
 * entry and an `inserted` flag (false on content_hash collision).
 *
 * Throws pg errors unchanged — the orchestrator maps 23505 on
 * promotion-specific indexes to `already_promoted` reasons, and
 * `MaintenanceActiveError` to the `maintenance_active` skip reason.
 */
export async function persistPromotedEntry(args: PersistArgs): Promise<PersistResult> {
  const parentSessionId = await resolveParentSessionId(args.sourceSessionId);

  const contentMd = args.englishSummary;
  const contentHash = sha256(
    `${args.episodeKind}\n${args.englishTitle.trim()}\n${args.englishSummary.trim()}`,
  );
  const sourceRefs: Record<string, unknown> = {
    source_episode_id: args.episodeId,
    source_session: args.sourceSessionId,
    ...(parentSessionId ? { parent_session_id: parentSessionId } : {}),
  };

  const { entry, inserted } = await withLeaseSharedLock(getPool(), (tx) =>
    knowledgeRepo.insertEntry(
      {
        kind: mapEpisodeKindToKnowledgeKind(args.episodeKind),
        title: args.englishTitle,
        summary: args.englishSummary,
        contentMd,
        tags: [],
        sourceRefs,
        confidence: null,
        pinned: false,
        validUntil: null,
        contentHash,
        embeddingModel: args.embeddingModel,
        embeddingDim: args.embeddingDim,
        embedding: args.embedding,
        sourceSurface: "echo_agent",
        sourceSession: args.sourceSessionId,
        sourceEpisodeId: args.episodeId,
        sourceEpisodeHash: args.episodeHash,
        promotionVersion: PROMOTION_VERSION,
      },
      tx,
    ),
  );
  return { entry, inserted };
}

/**
 * Episode kinds are a closed taxonomy; knowledge_entries.kind is free-form
 * text but tooling expects human labels. Map 1:1 for now.
 */
function mapEpisodeKindToKnowledgeKind(kind: EpisodeKind): string {
  return kind;
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

async function resolveParentSessionId(
  sourceSessionId: string,
): Promise<string | null> {
  try {
    const parent = await sessionLinksRepo.getParentSession(sourceSessionId);
    return parent?.parentSessionId ?? null;
  } catch (err) {
    // Attribution is best-effort; a missing parent_session_id does not
    // block the promotion itself.
    logger.warn("promotion.parent_lookup_failed", {
      sourceSessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
