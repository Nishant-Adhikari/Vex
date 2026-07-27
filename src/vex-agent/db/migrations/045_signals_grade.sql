-- Signal grade persistence — store the LLM-as-judge verdict on the signal row.
--
-- Until now the Signals grade was ephemeral: the `signals.grade` IPC handler
-- computed a verdict on demand (the per-row GRADE button) and returned it to the
-- renderer's React Query cache — nothing was written back. The signals-ingest
-- worker now AUTO-GRADES newly-ingested signals as they arrive (volume is tiny,
-- ~3/hour), so the verdict must persist on the row it grades.
--
-- Columns are all NULLable; NULL `grade` == "not yet graded" and is exactly the
-- predicate the auto-grader selects on (idempotent: an already-graded row is
-- never re-graded automatically — the manual GRADE button stays the explicit
-- re-grade path). Grading is DISCOVERY only: these columns never authorise a
-- trade; a mission still runs the exit-safety scan + human approval gate.
--
--   grade            0-100, higher = more likely a real runner (LLM-as-judge)
--   grade_verdict    coarse bucket: 'runner' | 'trap' | 'neutral'
--   grade_rationale  one-line (<=200 char) justification
--   graded_at        when the verdict was written (NULL == ungraded)

ALTER TABLE signals ADD COLUMN IF NOT EXISTS grade           INTEGER;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS grade_verdict   TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS grade_rationale TEXT;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS graded_at       TIMESTAMPTZ;

-- The auto-grader's hot lookup is "freshest ungraded rows"; a partial index on
-- the ungraded set keeps that scan cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_signals_ungraded
  ON signals (ingested_at DESC)
  WHERE grade IS NULL;
