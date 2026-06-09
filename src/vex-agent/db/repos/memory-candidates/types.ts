/**
 * memory_candidates repo — row types, domain types, mappers, helpers.
 *
 * Pure-data module: interfaces + pg-row → domain conversion + small pgvector /
 * date serialization helpers. `vectorLiteral` and `toIsoOrNull` are kept LOCAL
 * (copied, not imported from `../knowledge/types.js`) to avoid coupling this
 * repo to the knowledge repo's internals — the same precedent as
 * `knowledge-lifecycle/types.ts`.
 *
 * Embedding contract mirrors `knowledge_entries` / `session_memories`: the
 * vector column has NO typmod; per-row `embedding_model` + `embedding_dim` are
 * authoritative. The raw embedding is write-only here — it is NOT mapped back
 * into the domain object (siblings do the same); `RETURNING *` returns it at
 * runtime and `mapRow` simply ignores it.
 *
 * Provenance shapes (`SourceRefs` / `EvidenceRefs`) are the strict, bounded
 * types from `memory/schema/memory-candidate.ts`. The repo only ever writes
 * Zod-validated values, so the row is guaranteed to hold those shapes.
 */

import type {
  EvidenceRefs,
  SourceRefs,
} from "@vex-agent/memory/schema/memory-candidate.js";
import type {
  CandidateEvidenceStrength,
  CandidateProposedBy,
  CandidateRetrievalVisibility,
  CandidateSensitivity,
  CandidateStatus,
} from "@vex-agent/memory/schema/memory-candidate-enums.js";
import type { KnowledgeSource } from "@vex-agent/memory/long-memory-source-policy.js";

// Re-export the lifecycle enum so repo consumers get it from one place.
export type { CandidateStatus } from "@vex-agent/memory/schema/memory-candidate-enums.js";

// ── Pg row shape (snake_case) ───────────────────────────────────
//
// `embedding` is intentionally omitted: it is write-only and `mapRow` never
// reads it (matches knowledge / session-memories). Timestamps are declared as
// `string` to match the sibling repos; the driver may hand back `Date` objects
// (no global type parser is configured) — downstream consumers coerce via
// `new Date()` exactly as the knowledge repo does.
export interface MemoryCandidateRow {
  id: string;
  session_id: string;
  proposed_by: string;
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  entities: string[] | null;
  tags: string[] | null;
  source_refs: SourceRefs | null;
  evidence_refs: EvidenceRefs | null;
  outcome: Record<string, unknown> | null;
  source: string;
  confidence: number | null;
  importance: number;
  sensitivity: string;
  evidence_strength: string;
  retrieval_visibility: string;
  retrieval_until: string | null;
  status: string;
  retain_until: string | null;
  embedding_model: string;
  embedding_dim: number;
  content_hash: string;
  event_time: string | null;
  observed_at: string | null;
  recorded_at: string;
  available_at_decision_time: string | null;
  promoted_knowledge_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface MemoryCandidateRowWithInsertFlag extends MemoryCandidateRow {
  inserted: boolean;
}

// ── Domain shape (camelCase) ────────────────────────────────────

export interface MemoryCandidate {
  id: string;
  sessionId: string;
  proposedBy: CandidateProposedBy;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  entities: string[];
  tags: string[];
  /** Strict pointer-only provenance (messageIds / toolCallIds). */
  sourceRefs: SourceRefs;
  /** Immutable evidence anchors (FIX-1): protocol_executions / capture_items ids + semantic keys. */
  evidenceRefs: EvidenceRefs;
  /** System-derived trade/decision outcome (S5); null until resolved. */
  outcome: Record<string, unknown> | null;
  /** System-derived provenance tier — NOT trusted from the agent. */
  source: KnowledgeSource;
  confidence: number | null;
  importance: number;
  sensitivity: CandidateSensitivity;
  evidenceStrength: CandidateEvidenceStrength;
  retrievalVisibility: CandidateRetrievalVisibility;
  /** Dual-trace TTL — when the not-consolidated trace stops surfacing. */
  retrievalUntil: string | null;
  status: CandidateStatus;
  /** System TTL for the candidate row itself. */
  retainUntil: string | null;
  embeddingModel: string;
  embeddingDim: number;
  contentHash: string;
  // Point-in-time (S5 no-lookahead gating).
  eventTime: string | null;
  observedAt: string | null;
  recordedAt: string;
  availableAtDecisionTime: string | null;
  /** knowledge_entries.id this candidate promoted into (set on 'promoted'), or null. */
  promotedKnowledgeId: number | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Repo INSERT input — the trusted, typed value the suggest boundary (S2) hands
 * to `insertCandidate`. Every NOT NULL column without a system default is
 * required; nullable columns are `| null`. Columns the DB / repo own
 * (`id`, `status` default 'pending', `outcome`, `recordedAt`,
 * `promotedKnowledgeId`, `created_at`, `updated_at`) are NOT here. External
 * input is already Zod-validated upstream (`candidateSuggestInputSchema` +
 * `sourceRefsSchema` / `evidenceRefsSchema`); the repo operates on trusted
 * shapes only.
 */
export interface InsertCandidateInput {
  sessionId: string;
  proposedBy: CandidateProposedBy;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  entities: string[];
  tags: string[];
  sourceRefs: SourceRefs;
  evidenceRefs: EvidenceRefs;
  /** System-derived provenance tier (manager-derived; never the agent's claim). */
  source: KnowledgeSource;
  confidence: number | null;
  importance: number;
  sensitivity: CandidateSensitivity;
  evidenceStrength: CandidateEvidenceStrength;
  retrievalVisibility: CandidateRetrievalVisibility;
  retrievalUntil: Date | null;
  retainUntil: Date | null;
  /** Vector as plain number[]. MUST match embeddingDim (DB CHECK + repo precheck). */
  embedding: number[];
  embeddingModel: string;
  embeddingDim: number;
  contentHash: string;
  eventTime: Date | null;
  observedAt: Date | null;
  availableAtDecisionTime: Date | null;
}

export interface InsertCandidateResult {
  candidate: MemoryCandidate;
  /** True iff newly inserted; false iff a pending row with this content_hash already existed. */
  inserted: boolean;
}

// ── Mapper ──────────────────────────────────────────────────────

export function mapRow(r: MemoryCandidateRow): MemoryCandidate {
  return {
    id: r.id,
    sessionId: r.session_id,
    proposedBy: r.proposed_by as CandidateProposedBy,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    entities: r.entities ?? [],
    tags: r.tags ?? [],
    sourceRefs: r.source_refs ?? {},
    evidenceRefs: r.evidence_refs ?? [],
    outcome: r.outcome,
    source: r.source as KnowledgeSource,
    confidence: r.confidence,
    importance: r.importance,
    sensitivity: r.sensitivity as CandidateSensitivity,
    evidenceStrength: r.evidence_strength as CandidateEvidenceStrength,
    retrievalVisibility: r.retrieval_visibility as CandidateRetrievalVisibility,
    retrievalUntil: r.retrieval_until,
    status: r.status as CandidateStatus,
    retainUntil: r.retain_until,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    contentHash: r.content_hash,
    eventTime: r.event_time,
    observedAt: r.observed_at,
    recordedAt: r.recorded_at,
    availableAtDecisionTime: r.available_at_decision_time,
    promotedKnowledgeId: r.promoted_knowledge_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Dual-trace recall (S3) ──────────────────────────────────────
//
// `recallCandidatesTopK` does its own vector SELECT (the shared
// `CANDIDATE_COLUMNS` deliberately omits `embedding`), returning the cosine
// distance so the mapper can expose similarity = 1 - distance. Only the fields
// S3 ranking + output need are selected — recall stays cheap.

/**
 * Pg row shape for `recallCandidatesTopK`. A bounded projection of
 * `memory_candidates` PLUS `cosine_distance` from the `<=>` operator. snake_case.
 */
export interface MemoryCandidateRecallRow {
  id: string;
  kind: string;
  title: string;
  summary: string;
  content_md: string;
  tags: string[] | null;
  evidence_refs: EvidenceRefs | null;
  source: string;
  retrieval_until: string | null;
  /** pgvector cosine distance via `<=>`; the mapper exposes similarity = 1 - distance. */
  cosine_distance: number;
}

/**
 * Domain shape for a recalled dual-trace candidate (S3). camelCase, carries the
 * derived `similarity` (clamped [0,1]). NOT the full `MemoryCandidate` — recall
 * only surfaces the ranking + output fields.
 */
export interface MemoryCandidateRecall {
  id: string;
  kind: string;
  title: string;
  summary: string;
  contentMd: string;
  tags: string[];
  evidenceRefs: EvidenceRefs;
  /** System-derived provenance tier (flat-weighted in S3 — never the agent's claim). */
  source: KnowledgeSource;
  retrievalUntil: string | null;
  /** Cosine similarity in [0,1] (1 - cosine_distance, clamped). */
  similarity: number;
}

export function mapRecallRow(r: MemoryCandidateRecallRow): MemoryCandidateRecall {
  return {
    id: r.id,
    kind: r.kind,
    title: r.title,
    summary: r.summary,
    contentMd: r.content_md,
    tags: r.tags ?? [],
    evidenceRefs: r.evidence_refs ?? [],
    source: r.source as KnowledgeSource,
    retrievalUntil: r.retrieval_until,
    similarity: clampUnit(1 - r.cosine_distance),
  };
}

/**
 * Clamp a value to the unit interval [0,1]; non-finite → 0. Local copy of the
 * knowledge repo helper (kept local to avoid coupling this repo to knowledge
 * internals — the knowledge-lifecycle precedent).
 */
export function clampUnit(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

// ── Local serialization helpers (kept local to avoid cyclic imports) ──

/**
 * Serialize a number[] to a pgvector literal `[a,b,c]`, cast via `$N::vector`.
 * Local copy of the knowledge repo helper — kept here so this repo does not
 * import knowledge internals (knowledge-lifecycle precedent).
 */
export function vectorLiteral(v: readonly number[]): string {
  return "[" + v.join(",") + "]";
}

/**
 * Parse a pgvector text literal `[a,b,c]` back into a `number[]`. The inverse of
 * `vectorLiteral`; used by `getCandidateEmbedding` to reuse a candidate's stored
 * vector at promote time (no re-embed). An empty `[]` yields `[]`; a malformed
 * literal throws (programmer error — the column is repo-owned and always valid).
 */
export function parseVectorLiteral(literal: string): number[] {
  const trimmed = literal.trim();
  if (trimmed.length < 2 || trimmed[0] !== "[" || trimmed[trimmed.length - 1] !== "]") {
    throw new Error(`parseVectorLiteral: malformed pgvector literal (len=${literal.length})`);
  }
  const inner = trimmed.slice(1, -1).trim();
  if (inner.length === 0) return [];
  return inner.split(",").map((part) => {
    const n = Number.parseFloat(part);
    if (!Number.isFinite(n)) {
      throw new Error("parseVectorLiteral: non-finite component in pgvector literal");
    }
    return n;
  });
}

/** Convert an optional Date to an ISO string (or null) for a timestamptz param. */
export function toIsoOrNull(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ── Column list (single source of truth for reads) ──────────────
//
// Mirrors `MemoryCandidateRow` exactly and DELIBERATELY excludes `embedding`:
// reads never need the raw vector (recall does its own vector SELECT in S3), so
// list / get queries stay cheap. INSERT uses `RETURNING *` (the proven xmax
// upsert pattern) and `mapRow` ignores the returned embedding.
export const CANDIDATE_COLUMNS = `
  id, session_id, proposed_by, kind, title, summary, content_md,
  entities, tags, source_refs, evidence_refs, outcome, source,
  confidence, importance, sensitivity, evidence_strength, retrieval_visibility,
  retrieval_until, status, retain_until,
  embedding_model, embedding_dim, content_hash,
  event_time, observed_at, recorded_at, available_at_decision_time,
  promoted_knowledge_id, created_at, updated_at
`;
