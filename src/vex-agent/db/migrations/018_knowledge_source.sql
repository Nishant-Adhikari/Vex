-- Knowledge entry source classification — distinguishes verified facts from
-- agent-generated hypotheses. Only `observed` and `user_confirmed` entries
-- surface in Active Memory hot context; `inferred` and `hypothesis` are
-- recall-only (queryable via `long_memory_search`) so the agent can revisit
-- them deliberately but they do not pollute the always-on system prompt.
--
-- This guards against the "agent saves its own hypothesis as a durable
-- preference" failure mode flagged during plan review. Combined with the
-- two-tier redaction policy in `memory/redaction.ts`, it keeps the long-
-- term memory layer free of unverified narrative.
--
-- Backfill: existing rows default to `observed` because they were written
-- before this distinction existed. Writers can override per call.
--
-- Active Memory hot context (`listActiveForHotContext`) must filter
-- `source IN ('observed', 'user_confirmed')` after this migration lands —
-- the index `idx_ke_active_hot_source` supports that filter.

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'observed'
  CHECK (source IN ('observed', 'user_confirmed', 'inferred', 'hypothesis'));

-- Composite partial index for hot-context filter. Matches the WHERE clause
-- used in `listActiveForHotContext`: status='active' AND source IN hot set
-- AND (pinned OR valid_until > NOW()). The leading status + source columns
-- carry the filter; ordering by pinned DESC, updated_at DESC is the hot path.
CREATE INDEX IF NOT EXISTS idx_ke_active_hot_source
  ON knowledge_entries(status, source, pinned DESC, updated_at DESC)
  WHERE status = 'active' AND source IN ('observed', 'user_confirmed');

COMMENT ON COLUMN knowledge_entries.source IS
  'Provenance classification. observed = directly seen tool result or user statement; user_confirmed = user explicitly affirmed; inferred = agent-derived from pattern; hypothesis = agent guess. Only observed + user_confirmed surface in Active Memory hot context.';
