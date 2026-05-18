/**
 * Memory layer policy — pure TS constants and helpers for the per-session
 * narrative memory system (`session_memories` table + Track 2 chunking
 * pipeline + `memory_recall` tool).
 *
 * No DB, no embeddings, no I/O. Tested as plain unit tests.
 *
 * Design notes:
 * - All chunk text is in the session's language (multilingual via
 *   EmbeddingGemma's native multilingual support). Knowledge entries stay
 *   English-only — promotion across that boundary is out of scope here.
 * - `theme` is a free-form slug, not an enum. Structured fields (entities,
 *   protocols, error_classes, chains, tasks) carry the discriminators that
 *   would otherwise force a rigid kind taxonomy.
 * - Exclusion rules (`./exclusion-rules.ts`) and redaction (`./redaction.ts`)
 *   apply to all chunker output before DB write — live state and secrets
 *   never land in long-term storage.
 */

// ── Chunking limits ──────────────────────────────────────────────

/**
 * Maximum number of `thread_themes_hints` the agent may pass to `compact_now`.
 * Chunk count itself is intentionally UNCAPPED — the chunker LLM decides how
 * many narrative chunks the archived prefix warrants. Slicing or rejecting
 * past a hard cap would throw away the model's deliberate signal; see codex
 * PR5 audit and the user instruction "wtf slice, truncate".
 */
export const MAX_THEME_HINTS = 3;

/** Maximum length of any single chunk markdown section (`happened_md`, `did_md`, `tried_md`). */
export const CHUNK_SECTION_MAX_CHARS = 2000;

/** Maximum length of the materialized `body_md` (sum of sections + headers). */
export const CHUNK_BODY_MAX_CHARS = 8000;

/** Maximum number of outstanding items per chunk. */
export const MAX_OUTSTANDING_ITEMS_PER_CHUNK = 5;

/** Maximum length of a single outstanding item's text or resolution_note. */
export const OUTSTANDING_ITEM_TEXT_MAX = 500;

// ── Recall limits ───────────────────────────────────────────────

/** Default `k` for `memory_recall` when caller omits it. */
export const MEMORY_RECALL_DEFAULT_K = 5;

/** Hard upper bound on `k` for `memory_recall`. */
export const MEMORY_RECALL_MAX_K = 5;

/** Minimum cosine similarity for a chunk to be included in recall results. */
export const MEMORY_RECALL_MIN_SIMILARITY = 0.30;

// ── Banner / state surface ──────────────────────────────────────

/** Maximum number of distinct recent themes shown in the session memory banner. */
export const MEMORY_BANNER_RECENT_THEMES_LIMIT = 5;

/** Maximum number of `kind` values shown in the Active Knowledge banner top-kinds line. */
export const KNOWLEDGE_BANNER_TOP_KINDS_LIMIT = 5;

// ── Pressure bands ──────────────────────────────────────────────

/** Token-budget fraction at which the informational banner appears in the system prompt. */
export const PRESSURE_WARNING_FRACTION = 0.85;

/** Token-budget fraction at which the hard compact barrier engages (tools restricted). */
export const PRESSURE_BARRIER_FRACTION = 0.88;

/** Token-budget fraction at which the runtime forced-fallback fires (agent did not call compact_now). */
export const PRESSURE_CRITICAL_FRACTION = 0.92;

/** Number of turns post-compact during which the deterministic bridge resume packet is injected. */
export const POST_COMPACT_BRIDGE_CYCLES = 2;

// ── Theme / chunk validation ────────────────────────────────────

/**
 * Tokens that are forbidden as a theme on their own. The chunker is allowed
 * to use these as part of a compound theme (e.g. `kyber_quote_debug` is fine)
 * but a bare `debug` or `session` slug is rejected as degenerate.
 */
export const THEME_STOPLIST_STANDALONE = new Set<string>([
  "mission",
  "session",
  "debug",
  "setup",
  "work",
  "task",
  "general",
  "various",
  "miscellaneous",
  "context",
  "conversation",
  "chat",
]);

/** Theme slug regex: 3-8 underscore-separated lowercase alphanumeric tokens. */
export const THEME_REGEX = /^[a-z][a-z0-9]*(?:_[a-z0-9]+){2,7}$/;

// ── Exclusion (live-state) thresholds ───────────────────────────

/**
 * If exclusion-rules detect that ≥ this fraction of a chunk's `body_md` words
 * match live-state patterns (balances, prices, gas, tx hashes), the chunk is
 * rejected entirely. Live state belongs in tool calls, not embedded memory.
 */
export const EXCLUSION_REJECT_THRESHOLD = 0.30;

// ── Outbox worker ───────────────────────────────────────────────

/** Worker heartbeat interval (must be < stale threshold). */
export const WORKER_HEARTBEAT_INTERVAL_MS = 20_000;

/** Stale threshold for `running` jobs whose heartbeat has not been updated. */
export const WORKER_STALE_THRESHOLD_MS = 2 * 60_000;

/** Max attempts before a job is marked `permanently_failed`. */
export const WORKER_MAX_ATTEMPTS = 3;

/** Per-LLM-call timeout for Track 2 chunking. */
export const TRACK2_TIMEOUT_MS = 30_000;

/** Initial retry backoff (multiplied by attempt_count for exponential schedule). */
export const TRACK2_RETRY_BACKOFF_BASE_MS = 30_000;

// ── Knowledge source provenance ─────────────────────────────────

/**
 * Sources eligible for Active Knowledge hot-context injection. Inferred and
 * hypothesis entries are still recallable via `knowledge_recall` but never
 * auto-injected — they require deliberate retrieval by the agent.
 */
export type KnowledgeSource = "observed" | "user_confirmed" | "inferred" | "hypothesis";

export const KNOWLEDGE_SOURCES: readonly KnowledgeSource[] = [
  "observed",
  "user_confirmed",
  "inferred",
  "hypothesis",
] as const;

export const HOT_CONTEXT_SOURCES: readonly KnowledgeSource[] = [
  "observed",
  "user_confirmed",
] as const;

export function isKnowledgeSource(value: unknown): value is KnowledgeSource {
  return typeof value === "string"
    && (KNOWLEDGE_SOURCES as readonly string[]).includes(value);
}

export function isHotContextSource(source: KnowledgeSource): boolean {
  return (HOT_CONTEXT_SOURCES as readonly string[]).includes(source);
}

// ── Helpers ─────────────────────────────────────────────────────

/** Clamp a caller-supplied `k` for `memory_recall` to the allowed range. */
export function clampMemoryRecallK(k: number | undefined): number {
  if (k === undefined || !Number.isFinite(k) || k <= 0) return MEMORY_RECALL_DEFAULT_K;
  if (k > MEMORY_RECALL_MAX_K) return MEMORY_RECALL_MAX_K;
  return Math.floor(k);
}

/**
 * Classify a token-budget fraction into a pressure band. The bands gate tool
 * visibility, system prompt banners, and runtime forced-fallback behavior.
 */
export type PressureBand = "normal" | "warning" | "barrier" | "critical";

export function classifyPressure(fraction: number): PressureBand {
  if (!Number.isFinite(fraction) || fraction < 0) return "normal";
  if (fraction >= PRESSURE_CRITICAL_FRACTION) return "critical";
  if (fraction >= PRESSURE_BARRIER_FRACTION) return "barrier";
  if (fraction >= PRESSURE_WARNING_FRACTION) return "warning";
  return "normal";
}
