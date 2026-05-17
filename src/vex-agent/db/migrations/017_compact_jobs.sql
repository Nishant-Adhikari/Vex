-- Compact jobs outbox — Track 2 of the compact pipeline.
--
-- Background worker picks up jobs and produces narrative chunks for
-- `session_memories` via a separate LLM call (uses the same OpenRouter
-- provider configured by the user — no extra env vars). Failure of Track 2
-- MUST NOT block the compact itself; the agent's summary (Track 1) and
-- archive land synchronously in Phase II of `executeCheckpoint`, while this
-- table accumulates pending chunking work for async retry.
--
-- Crash recovery contract:
--   - `next_attempt_at` is NOT NULL with DEFAULT NOW(), so the polling query
--     (`status IN ('pending','failed') AND next_attempt_at <= NOW()`) does
--     not silently miss newly-enqueued rows.
--   - `locked_at`/`locked_by`/`heartbeat_at` track in-flight work. Worker
--     bootstrap on app start resets `status='running'` rows whose
--     `heartbeat_at` is older than the stale threshold (2 minutes) — they
--     come back as `pending` with backoff applied.
--   - Per-(session_id, generation) UNIQUE prevents double-enqueue on race.
--
-- Audit columns (`inference_provider`, `inference_model`, `inference_completed_at`,
-- `cost_usd`) are stamped from `provider.loadConfig()` at chunker call time;
-- secrets never land in this table. User-visible cost log surfaces in the
-- settings UI.

CREATE TABLE IF NOT EXISTS compact_jobs (
  id                              SERIAL PRIMARY KEY,
  session_id                      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  checkpoint_generation           INTEGER NOT NULL,

  status                          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed','permanently_failed')),

  -- Inputs captured at `compact_now` invocation time
  agent_summary                   TEXT NOT NULL,
  preserve_md                     TEXT,
  thread_themes_hints             TEXT[] NOT NULL DEFAULT '{}',
  source_start_message_id         INTEGER,
  source_end_message_id           INTEGER NOT NULL,

  -- Worker state — retry + heartbeat
  attempt_count                   INTEGER NOT NULL DEFAULT 0,
  max_attempts                    INTEGER NOT NULL DEFAULT 3,
  next_attempt_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at                       TIMESTAMPTZ,
  locked_by                       TEXT,
  heartbeat_at                    TIMESTAMPTZ,
  last_error                      TEXT,

  -- Outputs (after successful chunking pass)
  chunks_inserted                 INTEGER NOT NULL DEFAULT 0,
  chunks_rejected_by_exclusion    INTEGER NOT NULL DEFAULT 0,
  chunks_rejected_by_redaction    INTEGER NOT NULL DEFAULT 0,

  -- Audit (no secrets — only provider name + model name)
  inference_provider              TEXT,
  inference_model                 TEXT,
  inference_completed_at          TIMESTAMPTZ,
  cost_usd                        NUMERIC(10,4),

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at                      TIMESTAMPTZ,
  completed_at                    TIMESTAMPTZ
);

-- One job per (session, generation). ON CONFLICT enqueue path uses this.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_compact_jobs_generation
  ON compact_jobs(session_id, checkpoint_generation);

-- Polling query support: pick pending/failed jobs whose retry time has come.
-- Partial keeps the index small (terminal statuses dominate over time).
CREATE INDEX IF NOT EXISTS idx_cj_status_due
  ON compact_jobs(status, next_attempt_at)
  WHERE status IN ('pending', 'failed');

-- Stale-running detection: bootstrap query scans heartbeat among running rows.
CREATE INDEX IF NOT EXISTS idx_cj_running_heartbeat
  ON compact_jobs(heartbeat_at)
  WHERE status = 'running';

COMMENT ON TABLE compact_jobs IS
  'Track 2 outbox. Worker produces session_memories chunks asynchronously; compact (Track 1 + archive) is unaffected by Track 2 failures. Heartbeat + stale-recovery via locked_at/heartbeat_at; per-(session,generation) UNIQUE prevents race duplicates.';
