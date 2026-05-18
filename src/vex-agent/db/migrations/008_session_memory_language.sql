-- Per-session memory language code.
--
-- Adds `sessions.memory_language_code` — the per-session language contract
-- inferred by the LLM at the first checkpoint and persisted via
-- `db/repos/sessions.ts::setMemoryLanguageCode`. Drives multilingual recall
-- (`session_memories` body_md is rendered in this language). Knowledge entries
-- stay English-only — translation happens at the memory → knowledge promotion
-- boundary, not on every turn.
--
-- Value shape:
--   2-3 lowercase letters, optional "-REGION" suffix (e.g. "en", "pl",
--   "fr", "zh", "vi", "pt-BR"), or the literal "und" for mixed/unclear.
--   Validated at the code boundary by `db/repos/sessions.ts::setMemoryLanguageCode`
--   (regex ^([a-z]{2,3}(-[A-Z]{2})?|und)$). Deliberately NO DB CHECK so that
--   adding a new language in the future does not require a migration.
--
-- Historical note: this migration originally also renamed `session_episodes.summary_en`
-- → `summary_text` and added `session_episodes.title`. The PR4 sunset deleted
-- `session_episodes` entirely (replaced by `session_memories` from migration
-- 016), so only the `sessions.memory_language_code` add remains here.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS memory_language_code TEXT;

COMMENT ON COLUMN sessions.memory_language_code IS
  'Per-session memory language (2-3 char code, optional -REGION, or "und"). NULL = not yet inferred. Validated at code boundary, not DB CHECK.';
