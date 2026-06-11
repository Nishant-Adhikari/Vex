-- Drop the legacy recall-overflow cache (memory-system S9 cutover, 2026-06-11).
--
-- `recall_cache_entries` backed the retired legacy recall tool surface
-- (inline/overflow split). The v2 long-memory read path caps inline payloads
-- instead of spilling to a cache table, so the table has zero readers and
-- zero writers after the cutover.
--
-- A NEW numbered migration paired with an in-place edit of 001 (the runner
-- applies only versions > the recorded max, so initialized DBs never re-run
-- 001):
--   - FRESH DB:        001 no longer creates the table → this DROP is a no-op
--                      (hence IF EXISTS).
--   - INITIALIZED DB:  001 already ran with the table → this migration cleans
--                      it up. The table held only short-TTL ephemeral cache
--                      rows, so dropping it loses nothing durable.

DROP TABLE IF EXISTS recall_cache_entries;
