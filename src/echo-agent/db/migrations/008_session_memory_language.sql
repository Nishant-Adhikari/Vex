-- PR2 — multilingual session memory pivot.
--
-- This migration moves session memory from an English-only contract to a
-- per-session language contract driven by the LLM at checkpoint time.
-- Knowledge entries stay English-only — translation happens at the
-- episode → knowledge promotion boundary (PR4), not on every turn.
--
-- Three independent schema changes, applied in one migration:
--   (1) RENAME session_episodes.summary_en → summary_text.
--       The column now carries text in the session's language, not forced
--       English. The TypeScript mappers are renamed in lockstep — search for
--       `summaryEn` in src/echo-agent/** after applying.
--   (2) ADD session_episodes.title — a short, LLM-generated episode title
--       (≤ 100 chars, in the session's language). Replaces the pre-PR2
--       `summary.slice(0, 120)` quasi-title used by checkpoint.ts as the
--       `title` argument to embedDocument. DEFAULT '' so the runtime
--       fallback (`title.trim() || summary_text.slice(0, 120)`) is trivial
--       when the LLM omits the field.
--   (3) ADD sessions.memory_language_code — per-session memory language
--       contract. NULL = not yet inferred; the first checkpoint of the
--       session infers a value and persists it via the
--       `session_language_inferred` field in extract.ts JSON output.
--
-- Value shape for memory_language_code:
--   2-3 lowercase letters, optional "-REGION" suffix (e.g. "en", "pl",
--   "fr", "zh", "vi", "pt-BR"), or the literal "und" for mixed/unclear.
--   Validated at the code boundary by db/repos/sessions.ts::setMemoryLanguageCode
--   (regex ^([a-z]{2,3}(-[A-Z]{2})?|und)$). Deliberately NO DB CHECK so that
--   adding a new language in the future does not require a migration.
--
-- Hash invariant (must stay green for dedupe):
--   episode_hash = sha256(episode_kind + '\n' + summary_text). The rename
--   keeps the hash input intact (we hash the TEXT, not the column name).
--   The new `title` column is deliberately NOT part of the hash — a retry
--   that produces a different title on the same summary must still dedupe.

ALTER TABLE session_episodes
  RENAME COLUMN summary_en TO summary_text;

ALTER TABLE session_episodes
  ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT '';

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS memory_language_code TEXT;

COMMENT ON COLUMN session_episodes.summary_text IS
  'Episode summary in the session''s language (see sessions.memory_language_code). English-only was the pre-PR2 contract; this column name replaces summary_en.';

COMMENT ON COLUMN session_episodes.title IS
  'LLM-generated episode title, <=100 chars, same language as summary_text. Used as the title argument to embedDocument(). Runtime fallback to summary_text.slice(0,120) when empty.';

COMMENT ON COLUMN sessions.memory_language_code IS
  'Per-session memory language (2-3 char code, optional -REGION, or "und"). NULL = not yet inferred. Validated at code boundary, not DB CHECK.';
