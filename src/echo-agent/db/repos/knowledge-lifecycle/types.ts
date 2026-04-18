/**
 * Shared types + row helpers for the knowledge supersede transaction.
 *
 * `mapRowLocal` is a local copy of the main `knowledge.ts` mapper — kept
 * here to avoid a cyclic import (this module is imported by
 * `knowledge.ts` ancestors in the barrel, and we don't want a back-edge).
 */

import type { KnowledgeEntry, InsertEntryInput } from "../knowledge.js";
import type { KnowledgeStatus } from "@echo-agent/knowledge/policy.js";

/**
 * Input shape mirrors `knowledge_write` params + lineage fields. We accept the
 * full `InsertEntryInput` for the successor (minus lifecycle fields, which the
 * supersede path controls) and separate lineage/audit fields.
 */
export type SupersedeInput = Omit<
  InsertEntryInput,
  "supersedesId" | "statusReason" | "changeSummary" | "whatFailed" | "status"
> & {
  previousId: number;
  /** Short "why" for the supersede — stored on the predecessor's `status_reason`. */
  reason: string;
  /** Optional "what's new" narrative — stored on the successor's `change_summary`. */
  changeSummary?: string | null;
  /** Optional evidence that predecessor was wrong — stored on successor's `what_failed`. */
  whatFailed?: string | null;
};

export interface SupersedeResult {
  /** The new active successor entry. */
  successor: KnowledgeEntry;
  /** The predecessor entry, now flipped to status=superseded. */
  predecessor: KnowledgeEntry;
}

export interface KnowledgeRowShape {
  id: number;
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string[] | null;
  source_refs: Record<string, unknown> | null;
  confidence: number | null;
  status: string;
  pinned: boolean;
  valid_from: string;
  valid_until: string | null;
  content_hash: string;
  embedding_model: string;
  embedding_dim: number;
  source_surface: string;
  source_session: string | null;
  supersedes_id: number | null;
  status_reason: string | null;
  change_summary: string | null;
  what_failed: string | null;
  created_at: string;
  updated_at: string;
}

export function mapRowLocal(r: KnowledgeRowShape): KnowledgeEntry {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    tags: r.tags ?? [],
    sourceRefs: r.source_refs ?? {},
    confidence: r.confidence,
    status: r.status as KnowledgeStatus,
    pinned: r.pinned,
    validFrom: r.valid_from,
    validUntil: r.valid_until,
    contentHash: r.content_hash,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    sourceSurface: (r.source_surface as "echo_agent" | "mcp_local") ?? "echo_agent",
    sourceSession: r.source_session,
    supersedesId: r.supersedes_id,
    statusReason: r.status_reason,
    changeSummary: r.change_summary,
    whatFailed: r.what_failed,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function vectorLiteral(v: readonly number[]): string {
  return "[" + v.join(",") + "]";
}
