-- Session memories — per-session narrative chunks produced by Track 2 of the
-- compact pipeline. Replaces the auto-injected `[Session episode recall]`
-- block in `turn.ts` with agent-driven `memory_recall` semantic retrieval.
--
-- Layered alongside (not replacing) `session_episodes` for one release cycle:
-- legacy episodes table remains for backwards compat until PR4 sunsets it
-- after two weeks of green telemetry.
--
-- Embedding contract mirrors `session_episodes` and `knowledge_entries`:
-- vector column has NO typmod, per-row `embedding_model` + `embedding_dim`
-- are authoritative, and recall MUST filter on both — mixed-dim `<=>`
-- crashes pgvector.
--
-- Dedupe is per-session and content-hash based: `(session_id, content_hash)`
-- UNIQUE WHERE `status='active'`. content_hash is computed from the
-- IMMUTABLE narrative core only:
--   sha256(theme + happened_md + did_md + tried_md), length-prefixed.
-- Outstanding items and the materialized body_md are intentionally EXCLUDED
-- from the hash because they mutate via `mark_outstanding_resolved` — if
-- they were hashed, resolving any outstanding item would break the partial
-- unique invariant. Implication: two chunks with identical narrative core
-- but different outstanding lists collide on dedup; this is by design (the
-- narrative is the chunk's identity, outstanding items are mutable
-- annotations on it).
--
-- Hybrid schema rationale: 4 narrative columns + materialized `body_md`. The
-- body is deterministically rendered from the 4 columns AND the outstanding
-- items list (template versioned via `body_md_schema_version`). A future
-- template change re-renders + re-embeds without losing structured data.
-- Outstanding items are stored as structured JSONB array (each item
-- independently resolvable via `mark_outstanding_resolved`), NOT as
-- free-form markdown in the column, because row-level resolution would
-- falsely close unrelated open loops.

CREATE TABLE IF NOT EXISTS session_memories (
  id                              SERIAL PRIMARY KEY,
  session_id                      TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  checkpoint_generation           INTEGER NOT NULL,

  -- Theme + classification
  theme                           TEXT NOT NULL,
  theme_source                    TEXT NOT NULL CHECK (theme_source IN ('handoff','chunker','fallback')),
  entities                        TEXT[] NOT NULL DEFAULT '{}',
  protocols                       TEXT[] NOT NULL DEFAULT '{}',
  error_classes                   TEXT[] NOT NULL DEFAULT '{}',
  chains                          TEXT[] NOT NULL DEFAULT '{}',
  tasks                           TEXT[] NOT NULL DEFAULT '{}',

  -- Narrative content (4 sections + materialized body)
  happened_md                     TEXT NOT NULL DEFAULT '',
  did_md                          TEXT NOT NULL DEFAULT '',
  tried_md                        TEXT NOT NULL DEFAULT '',
  body_md                         TEXT NOT NULL,
  body_md_schema_version          TEXT NOT NULL DEFAULT 'v1',

  -- Outstanding items — structured JSONB array.
  -- Each element shape (enforced in Zod at write boundary, not via DB CHECK
  -- because per-element validation in JSONB is brittle):
  --   { id: uuid-v4 string,
  --     text: string ≤500 chars,
  --     created_at: ISO timestamp,
  --     resolved_at: ISO timestamp | null,
  --     resolution_note: string ≤500 chars | null,
  --     resolution_source: 'agent' | 'user' | 'auto' | null }
  -- IDs are generated at the chunker layer (server-side), never LLM-generated,
  -- to avoid collisions inside or across chunks.
  outstanding_items               JSONB NOT NULL DEFAULT '[]',

  -- Provenance
  source_start_message_id         INTEGER,
  source_end_message_id           INTEGER,
  language_code                   TEXT,
  inference_model                 TEXT,

  -- Quality signals
  importance                      INTEGER NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
  confidence                      NUMERIC(3,2) NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0 AND 1),
  status                          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','merged_into')),
  superseded_by_id                INTEGER REFERENCES session_memories(id) ON DELETE SET NULL,

  -- Embedding (NO typmod on vector — per-row dim is authoritative)
  embedding                       vector NOT NULL,
  embedding_model                 TEXT NOT NULL,
  embedding_dim                   INTEGER NOT NULL,

  -- Dedup key: sha256(theme + happened_md + did_md + tried_md) — length-
  -- prefixed encoding. Outstanding items and body_md intentionally EXCLUDED
  -- (see types.ts contract): outstanding mutates via markOutstandingResolved
  -- and including it would break the (session_id, content_hash) partial
  -- unique invariant on every resolution.
  content_hash                    CHAR(64) NOT NULL,

  created_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT sm_embedding_dim_range
    CHECK (embedding_dim > 0 AND embedding_dim <= 8192),
  CONSTRAINT sm_embedding_dim_matches_vector
    CHECK (vector_dims(embedding) = embedding_dim),
  CONSTRAINT sm_outstanding_items_is_array
    CHECK (jsonb_typeof(outstanding_items) = 'array')
);

-- Recall path: cosine search scoped to session, status='active'. Embedding
-- model/dim filter is mandatory (see contract above) — separate composite
-- index supports the filter.
CREATE INDEX IF NOT EXISTS idx_sm_session_active
  ON session_memories(session_id, created_at DESC)
  WHERE status = 'active';

-- Generation filter (banner state, post-compact recall scoping).
CREATE INDEX IF NOT EXISTS idx_sm_generation
  ON session_memories(session_id, checkpoint_generation);

-- Mandatory recall filter — mixed-dim/model crash protection.
CREATE INDEX IF NOT EXISTS idx_sm_embedding_match
  ON session_memories(embedding_model, embedding_dim);

-- Per-session dedup: same content within a session is a no-op insert.
-- Active-only partial keeps the index cheap and lets supersede flows
-- legitimately keep two rows with identical hash if one is superseded.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sm_content_dedup
  ON session_memories(session_id, content_hash)
  WHERE status = 'active';

-- Theme lookup for banner "recent themes" listing.
CREATE INDEX IF NOT EXISTS idx_sm_theme
  ON session_memories(session_id, theme)
  WHERE status = 'active';

-- Entity GIN for future "find chunks mentioning X" queries.
CREATE INDEX IF NOT EXISTS idx_sm_entities
  ON session_memories USING GIN (entities);

COMMENT ON TABLE session_memories IS
  'Per-session narrative chunks from compact Track 2. Replaces auto-injected episode recall with agent-driven memory_recall. Body_md is deterministically rendered from 4 narrative columns + outstanding_items JSONB for individual resolution.';
