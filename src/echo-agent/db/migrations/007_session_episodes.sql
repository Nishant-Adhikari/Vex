-- Session episodes — mid-term conversational memory layer.
--
-- Sits between `sessions.summary` (rolling, per-session) and `knowledge_entries`
-- (canonical, cross-session, curated). Episodes are write-once; promotion into
-- canonical knowledge is a separate follow-up, not covered by this migration.
--
-- Embedding contract mirrors `knowledge_entries`: vector column has NO typmod,
-- per-row `embedding_model` + `embedding_dim` are authoritative, and recall MUST
-- filter on both — mixed-dim `<=>` would crash pgvector.
--
-- Dedupe is scoped to a single compacted prefix: (session_id,
-- source_end_message_id, episode_hash) is UNIQUE WHERE source_end_message_id IS
-- NOT NULL. That lets an extractor emit multiple facts/decisions per prefix
-- (different summaries → different hashes) while retry-on-failure inserts
-- collapse to no-ops. Callers MUST use the same predicate in ON CONFLICT —
-- Postgres won't otherwise match a partial unique index.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS memory_scope_key TEXT;

CREATE TABLE IF NOT EXISTS session_episodes (
  id                       SERIAL PRIMARY KEY,
  session_id               TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  memory_scope_key         TEXT NOT NULL,
  episode_kind             TEXT NOT NULL,
  summary_en               TEXT NOT NULL,
  facts_jsonb              JSONB NOT NULL DEFAULT '{}',
  decisions_jsonb          JSONB NOT NULL DEFAULT '{}',
  open_loops_jsonb         JSONB NOT NULL DEFAULT '{}',
  entities                 TEXT[] NOT NULL DEFAULT '{}',
  tool_outcomes_jsonb      JSONB NOT NULL DEFAULT '{}',
  source_surface           TEXT NOT NULL DEFAULT 'echo_agent',
  source_session           TEXT,
  source_start_message_id  INTEGER,
  source_end_message_id    INTEGER,
  episode_hash             CHAR(64) NOT NULL,
  embedding_model          TEXT NOT NULL,
  embedding_dim            INTEGER NOT NULL,
  embedding                vector NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT se_episode_kind_enum CHECK (
    episode_kind IN ('decision','fact','preference','open_loop','tool_result_summary','lesson')
  ),
  CONSTRAINT se_embedding_dim_range CHECK (embedding_dim > 0 AND embedding_dim <= 8192),
  CONSTRAINT se_embedding_dim_matches_vector CHECK (vector_dims(embedding) = embedding_dim)
);

CREATE INDEX IF NOT EXISTS idx_se_session_created
  ON session_episodes(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_scope_created
  ON session_episodes(memory_scope_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_se_entities
  ON session_episodes USING GIN (entities);
CREATE INDEX IF NOT EXISTS idx_se_model_dim
  ON session_episodes(embedding_model, embedding_dim);

CREATE UNIQUE INDEX IF NOT EXISTS idx_se_dedupe
  ON session_episodes(session_id, source_end_message_id, episode_hash)
  WHERE source_end_message_id IS NOT NULL;
