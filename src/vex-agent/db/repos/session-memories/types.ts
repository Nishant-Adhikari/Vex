/**
 * Session-memories repo — row types, domain types, mappers, and column list.
 *
 * Single source of truth for:
 *   - Domain types (SessionMemory, NewSessionMemory, OutstandingItem, RecallFilters).
 *   - Row shapes used by the pg driver (`SessionMemoryRow`, recall variant).
 *   - `mapRow` — only place snake_case → camelCase translation lives.
 *   - `MEMORY_COLUMNS` — shared column list for INSERT RETURNING and SELECT.
 *
 * Embedding contract (mirrors `knowledge_entries`, `session_episodes`):
 *   - vector column has NO typmod; per-row `embedding_model` + `embedding_dim`
 *     are authoritative.
 *   - `embedding.length === embeddingDim` guard runs before SQL so the CHECK
 *     constraint never has to reject the row.
 *
 * Body materialization contract:
 *   - `body_md` is deterministically rendered from `happened_md`, `did_md`,
 *     `tried_md`, AND `outstanding_items` (rendered as a list with resolution
 *     state) via `renderBodyMd()`. `body_md_schema_version` ('v1') stamps the
 *     template so a future template change can re-render + re-embed.
 *   - `content_hash` is computed from the IMMUTABLE narrative core ONLY:
 *     `sha256(theme + happened_md + did_md + tried_md)` (length-prefixed).
 *     Outstanding items are NOT part of the hash because they mutate when
 *     resolved (`markOutstandingResolved` flips one element's resolved_at);
 *     including them would break the per-(session_id, content_hash) partial
 *     unique invariant after every resolution.
 *   - Implication: two chunks with identical narrative but different
 *     outstanding lists collide on dedup. Per design — the narrative is the
 *     chunk's identity; outstanding items are mutable annotations.
 */

import { createHash, randomUUID } from "node:crypto";

// ── Outstanding item ─────────────────────────────────────────────

/**
 * Domain shape (camelCase) — used inside TS code.
 */
export interface OutstandingItem {
  /** Server-generated UUID v4. Never LLM-emitted. */
  id: string;
  text: string;
  createdAt: string;
  resolvedAt: string | null;
  resolutionNote: string | null;
  resolutionSource: "agent" | "user" | "auto" | null;
}

/**
 * Persistence shape (snake_case) — exact JSONB structure stored on the row.
 * The migration documents these keys and the unresolved-count SQL queries
 * (`getSessionMemoryStats`) read `item->>'resolved_at'` directly, so the
 * column must serialize in snake_case. Conversion happens at the repo
 * boundary via `toPersistedItem` / `fromPersistedItem`.
 */
export interface OutstandingItemPersisted {
  id: string;
  text: string;
  created_at: string;
  resolved_at: string | null;
  resolution_note: string | null;
  resolution_source: "agent" | "user" | "auto" | null;
}

/** Input shape when chunker emits an outstanding item — id + createdAt are server-stamped. */
export interface NewOutstandingItem {
  text: string;
}

export function newOutstandingItem(text: string): OutstandingItem {
  return {
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    resolutionNote: null,
    resolutionSource: null,
  };
}

export function toPersistedItem(it: OutstandingItem): OutstandingItemPersisted {
  return {
    id: it.id,
    text: it.text,
    created_at: it.createdAt,
    resolved_at: it.resolvedAt,
    resolution_note: it.resolutionNote,
    resolution_source: it.resolutionSource,
  };
}

export function fromPersistedItem(p: OutstandingItemPersisted): OutstandingItem {
  return {
    id: p.id,
    text: p.text,
    createdAt: p.created_at,
    resolvedAt: p.resolved_at,
    resolutionNote: p.resolution_note,
    resolutionSource: p.resolution_source,
  };
}

// ── Domain ──────────────────────────────────────────────────────

export interface SessionMemory {
  id: number;
  sessionId: string;
  checkpointGeneration: number;
  theme: string;
  themeSource: "handoff" | "chunker" | "fallback";
  entities: string[];
  protocols: string[];
  errorClasses: string[];
  chains: string[];
  tasks: string[];
  happenedMd: string;
  didMd: string;
  triedMd: string;
  bodyMd: string;
  bodyMdSchemaVersion: string;
  outstandingItems: OutstandingItem[];
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
  languageCode: string | null;
  inferenceModel: string | null;
  importance: number;
  confidence: number;
  status: "active" | "superseded" | "merged_into";
  supersededById: number | null;
  embeddingModel: string;
  embeddingDim: number;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface NewSessionMemory {
  sessionId: string;
  checkpointGeneration: number;
  theme: string;
  themeSource: "handoff" | "chunker" | "fallback";
  entities: string[];
  protocols: string[];
  errorClasses: string[];
  chains: string[];
  tasks: string[];
  happenedMd: string;
  didMd: string;
  triedMd: string;
  outstandingTexts: string[]; // chunker emits raw strings; repo wraps as OutstandingItem
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
  languageCode: string | null;
  inferenceModel: string | null;
  importance?: number;
  confidence?: number;
  embeddingModel: string;
  embeddingDim: number;
  embedding: number[];
}

// ── Recall ──────────────────────────────────────────────────────

export interface RecallFilters {
  sessionId: string;
  embeddingModel: string;
  embeddingDim: number;
  topK: number;
  /** Minimum cosine similarity in [0, 1]. Rows below are filtered out. */
  minSimilarity?: number;
}

export interface RecallHit {
  memory: SessionMemory;
  similarity: number;
}

// ── Pg row shapes ───────────────────────────────────────────────

export interface SessionMemoryRow {
  id: number;
  session_id: string;
  checkpoint_generation: number;
  theme: string;
  theme_source: string;
  entities: string[] | null;
  protocols: string[] | null;
  error_classes: string[] | null;
  chains: string[] | null;
  tasks: string[] | null;
  happened_md: string;
  did_md: string;
  tried_md: string;
  body_md: string;
  body_md_schema_version: string;
  /** JSONB column — persistence shape is snake_case (see migration 016 comment). */
  outstanding_items: OutstandingItemPersisted[] | null;
  source_start_message_id: number | null;
  source_end_message_id: number | null;
  language_code: string | null;
  inference_model: string | null;
  importance: number;
  confidence: string; // pg numeric → string in driver
  status: string;
  superseded_by_id: number | null;
  embedding_model: string;
  embedding_dim: number;
  content_hash: string;
  created_at: string;
  updated_at: string;
}

export interface SessionMemoryRecallRow extends SessionMemoryRow {
  cosine_distance: number;
}

// ── Mapper ──────────────────────────────────────────────────────

export function mapRow(r: SessionMemoryRow): SessionMemory {
  return {
    id: r.id,
    sessionId: r.session_id,
    checkpointGeneration: r.checkpoint_generation,
    theme: r.theme,
    themeSource: r.theme_source as "handoff" | "chunker" | "fallback",
    entities: r.entities ?? [],
    protocols: r.protocols ?? [],
    errorClasses: r.error_classes ?? [],
    chains: r.chains ?? [],
    tasks: r.tasks ?? [],
    happenedMd: r.happened_md,
    didMd: r.did_md,
    triedMd: r.tried_md,
    bodyMd: r.body_md,
    bodyMdSchemaVersion: r.body_md_schema_version,
    outstandingItems: (r.outstanding_items ?? []).map(fromPersistedItem),
    sourceStartMessageId: r.source_start_message_id,
    sourceEndMessageId: r.source_end_message_id,
    languageCode: r.language_code,
    inferenceModel: r.inference_model,
    importance: r.importance,
    confidence: Number.parseFloat(r.confidence),
    status: r.status as "active" | "superseded" | "merged_into",
    supersededById: r.superseded_by_id,
    embeddingModel: r.embedding_model,
    embeddingDim: r.embedding_dim,
    contentHash: r.content_hash,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

// ── Column list (single source of truth) ─────────────────────────

export const MEMORY_COLUMNS = `
  id, session_id, checkpoint_generation,
  theme, theme_source, entities, protocols, error_classes, chains, tasks,
  happened_md, did_md, tried_md, body_md, body_md_schema_version,
  outstanding_items,
  source_start_message_id, source_end_message_id,
  language_code, inference_model,
  importance, confidence,
  status, superseded_by_id,
  embedding_model, embedding_dim,
  content_hash, created_at, updated_at
`;

// ── Body rendering + content hash ───────────────────────────────

/**
 * Deterministic body_md template. Versioned via `body_md_schema_version`
 * column so future template changes can re-render + re-embed without losing
 * structured columns.
 */
export const BODY_MD_SCHEMA_VERSION = "v1";

export function renderBodyMd(parts: {
  happenedMd: string;
  didMd: string;
  triedMd: string;
  outstandingItems: readonly OutstandingItem[];
}): string {
  const lines: string[] = [];
  lines.push("## What happened");
  lines.push(parts.happenedMd.trim() || "(none)");
  lines.push("");
  lines.push("## What I did");
  lines.push(parts.didMd.trim() || "(none)");
  lines.push("");
  lines.push("## What I tried");
  lines.push(parts.triedMd.trim() || "(none)");
  lines.push("");
  lines.push("## Outstanding");
  if (parts.outstandingItems.length === 0) {
    lines.push("(none)");
  } else {
    for (const item of parts.outstandingItems) {
      const status = item.resolvedAt
        ? `RESOLVED at ${item.resolvedAt} by ${item.resolutionSource ?? "unknown"}: ${item.resolutionNote ?? ""}`
        : "UNRESOLVED";
      lines.push(`- [${item.id}] ${item.text} (created ${item.createdAt}) — ${status}`);
    }
  }
  return lines.join("\n");
}

/**
 * Stable content hash for dedup. Computed from the IMMUTABLE narrative core
 * (theme + happened_md + did_md + tried_md). Outstanding items + body_md are
 * intentionally excluded because they mutate via `markOutstandingResolved`;
 * including them would break the per-(session_id, content_hash) partial
 * unique invariant on every resolution.
 *
 * Length-prefixed encoding (`${len}:${field}|...`) eliminates ambiguity from
 * newlines or `|` characters inside any field.
 */
export function computeContentHash(parts: {
  theme: string;
  happenedMd: string;
  didMd: string;
  triedMd: string;
}): string {
  const encoded = [
    `${parts.theme.length}:${parts.theme}`,
    `${parts.happenedMd.length}:${parts.happenedMd}`,
    `${parts.didMd.length}:${parts.didMd}`,
    `${parts.triedMd.length}:${parts.triedMd}`,
  ].join("|");
  return createHash("sha256").update(encoded).digest("hex");
}
