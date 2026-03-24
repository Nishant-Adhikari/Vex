-- 011: Manual mode fixes — approval provenance, messages archive, memory dedup

-- Store the originating chat mode with approval items for correct resume
ALTER TABLE approval_queue ADD COLUMN IF NOT EXISTS chat_mode TEXT DEFAULT 'restricted';

-- Archive table for compaction checkpoint (preserves history)
-- Use INCLUDING INDEXES only — do NOT inherit FK CASCADE (archive must survive session deletion)
CREATE TABLE IF NOT EXISTS messages_archive (LIKE messages INCLUDING INDEXES);
ALTER TABLE messages_archive DROP CONSTRAINT IF EXISTS messages_archive_session_id_fkey;

-- Memory dedup: content hash for exact-duplicate detection
ALTER TABLE memory_entries ADD COLUMN IF NOT EXISTS content_hash TEXT;

-- Backfill existing hashes
UPDATE memory_entries SET content_hash = md5(trim(content)) WHERE content_hash IS NULL;

-- Remove existing duplicates BEFORE creating unique index (keep newest by id)
DELETE FROM memory_entries a USING memory_entries b
  WHERE a.content_hash = b.content_hash
    AND a.content_hash IS NOT NULL
    AND a.id < b.id;

-- Race-safe unique index for dedup
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_hash_unique
  ON memory_entries(content_hash) WHERE content_hash IS NOT NULL;
