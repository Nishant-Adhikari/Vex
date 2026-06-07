/**
 * Long-memory source provenance policy — pure TS constants, types, and helpers
 * describing knowledge-entry provenance tiers (`knowledge_entries.source`) and
 * which tiers are eligible for Active Knowledge hot-context injection.
 *
 * No DB, no embeddings, no I/O. Tested as plain unit tests.
 */

// ── Banner / state surface ──────────────────────────────────────

/** Maximum number of `kind` values shown in the Active Knowledge banner top-kinds line. */
export const KNOWLEDGE_BANNER_TOP_KINDS_LIMIT = 5;

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
