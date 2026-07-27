-- Simulator tournament batches — group a cohort of paper missions launched
-- together, then track a current "winner" as finalized results arrive.

CREATE TABLE simulator_batches (
  id                 TEXT PRIMARY KEY,
  status             TEXT NOT NULL DEFAULT 'active'
                     CHECK (status IN ('active', 'completed', 'aborted')),
  goal               TEXT NOT NULL,
  requested_parallel INTEGER NOT NULL CHECK (requested_parallel > 0),
  launched_count     INTEGER NOT NULL DEFAULT 0 CHECK (launched_count >= 0),
  completed_count    INTEGER NOT NULL DEFAULT 0 CHECK (completed_count >= 0),
  winner_run_id      TEXT REFERENCES mission_runs(id),
  winner_score       NUMERIC,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE simulator_batch_entries (
  id             TEXT PRIMARY KEY,
  batch_id       TEXT NOT NULL REFERENCES simulator_batches(id) ON DELETE CASCADE,
  ordinal        INTEGER NOT NULL CHECK (ordinal > 0),
  session_id     TEXT NOT NULL REFERENCES sessions(id),
  mission_id     TEXT NOT NULL REFERENCES missions(id),
  mission_run_id TEXT NOT NULL UNIQUE REFERENCES mission_runs(id),
  status         TEXT NOT NULL DEFAULT 'running',
  score          NUMERIC,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id, ordinal)
);

CREATE INDEX simulator_batches_created_idx
  ON simulator_batches (created_at DESC);

CREATE INDEX simulator_batch_entries_batch_idx
  ON simulator_batch_entries (batch_id, ordinal);
