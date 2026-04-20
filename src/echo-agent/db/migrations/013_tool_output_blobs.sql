-- Wake-driven autonomy (PR-11 of the wake roadmap) — ephemeral off-prompt
-- storage for oversized tool outputs.
--
-- Turn-loop writes the full payload here whenever a tool returns more than
-- `TOOL_OUTPUT_OVERFLOW_BYTES` (16 KiB today, see knowledge/policy.ts) and
-- persists a short stub in `messages.content` plus `metadata.payload.blob_key`
-- so archive-aware checkpoint + recall keep the pointer alive after
-- compaction. `tool_output_read(blob_key)` is the retrieval tool.
--
-- Scope: per-session. A subagent's blobs are NOT reachable from the parent
-- because blob_key lookups enforce `blob.session_id === ctx.sessionId` at
-- the handler. TTL is short (~15 min default) — resume paths (mission or
-- full-autonomous) refresh TTLs for recent messages before continuation so
-- a wake that fires inside the TTL window still finds its blobs.

CREATE TABLE tool_output_blobs (
  blob_key TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  payload JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cleanup scan — lazy cleanup in the repo touches this during reads.
CREATE INDEX idx_tool_output_blobs_expires
  ON tool_output_blobs(expires_at);

-- Session-scoped refresh — resume paths pull the last N message blob_keys
-- and bump TTLs in a single statement; keep the lookup fast with an index
-- on session_id.
CREATE INDEX idx_tool_output_blobs_session
  ON tool_output_blobs(session_id);

COMMENT ON TABLE tool_output_blobs IS
  'Ephemeral off-prompt storage for oversized tool outputs. Per-session scope, short TTL. Turn-loop writes when result exceeds TOOL_OUTPUT_OVERFLOW_BYTES; resume paths refresh TTL.';
