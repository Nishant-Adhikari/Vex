-- 020 — vex-app session metadata: user-supplied display title + pin state.
--
-- Phase 1 of the vex-agent ↔ vex-app integration: the sidebar needs a
-- user-entered name (mandatory at create time) and pinning so high-value
-- sessions stay reachable above the time buckets.
--
-- Both columns are nullable — old rows (pre-020) keep working. The renderer
-- falls back to `initial_goal` or a mode-specific default when `title` is
-- NULL. `pinned_at` carries a timestamp instead of a boolean so the
-- pinned bucket can be ordered "most recently pinned first" without an
-- extra column.
--
-- Engine impact: `src/vex-agent/db/repos/sessions.ts` reads sessions via
-- `SELECT *` + `mapRow`, which explicitly enumerates known fields. New
-- columns are ignored by the engine, so this migration is additive-safe.
--
-- Idempotent: re-running the file is a no-op (IF NOT EXISTS on column
-- and index, scoped pg_constraint guard on CHECK).

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;

-- DB cap (120) > UI cap (80) on purpose. Protects against renderer bugs
-- that bypass the Zod boundary; UI still rejects > 80.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'sessions_title_length_check'
       AND conrelid = 'sessions'::regclass
  ) THEN
    ALTER TABLE sessions ADD CONSTRAINT sessions_title_length_check
      CHECK (title IS NULL OR char_length(title) <= 120);
  END IF;
END $$;

-- Partial index — only pinned rows are indexed, keeps it small and
-- supports the sidebar's pinned-first ORDER BY directly.
CREATE INDEX IF NOT EXISTS idx_sessions_pinned
  ON sessions(scope, pinned_at DESC, started_at DESC)
  WHERE pinned_at IS NOT NULL;
