-- Knowledge lifecycle lineage — adds supersede columns + partial unique index.
--
-- Forward-only migration for installs that already ran 001..005 (early local users on
-- shipped versions of Vex). On fresh DBs runMigrations applies 001..005
-- first, then this one — identical end state. Idempotent with IF NOT EXISTS so
-- re-runs on a partially-applied volume are safe.
--
-- Columns:
--   supersedes_id   — FK to the predecessor row this entry replaces. Populated
--                     only via the manager's supersede transaction: new row
--                     INSERTed with supersedes_id set AND predecessor flipped to
--                     status='superseded' in the same COMMIT. NULL = not a
--                     successor (either active original or terminal non-active).
--   status_reason   — Short "why" for any non-active status transition. Written
--                     by the supersede transaction (on predecessor: why replaced)
--                     and on invalidation / archival (manager-owned lifecycle).
--   change_summary  — Supersede-only: what's different about the new version.
--                     Written on the successor row (NULL elsewhere).
--   what_failed     — Supersede-only: evidence that invalidated the predecessor.
--                     Written on the successor row so long_memory_get(newId) can
--                     show the agent why the old rule was wrong.
--
-- Index:
--   idx_ke_supersedes_id — Partial unique index enforcing single-successor
--                          lineage (no branching versions in MVP). Also serves
--                          as the reverse-lookup index for getById's supersededBy.

ALTER TABLE knowledge_entries
  ADD COLUMN IF NOT EXISTS supersedes_id  INTEGER REFERENCES knowledge_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status_reason  TEXT,
  ADD COLUMN IF NOT EXISTS change_summary TEXT,
  ADD COLUMN IF NOT EXISTS what_failed    TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ke_supersedes_id
  ON knowledge_entries(supersedes_id)
  WHERE supersedes_id IS NOT NULL;
