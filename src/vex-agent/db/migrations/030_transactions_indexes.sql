-- Stage 9 — transactions-view indexes (forward-only, idempotent IF NOT EXISTS).
--
-- The `portfolio` tool's `transactions` view is a unified feed that FUSES two
-- halves into one keyset-paginated, txHash-anchorable feed (repo
-- `src/vex-agent/db/repos/transactions.ts`, handler `inspect-views/transactions.ts`):
--   1. SUCCESS half — proj_activity rows for the session's selected wallet set.
--   2. FAILURE half — protocol_executions rows WHERE success = false, scoped to
--      the current session, for the trade-impacting failure-tool allowlist.
--
-- Each index below serves a specific access path of that view. All three are
-- forward-only and idempotent (IF NOT EXISTS) — no data is read or moved.

-- SUCCESS-half keyset hot path. The view filters by wallet_address (= ANY) and
-- paginates with the (created_at DESC, id DESC) keyset tuple. The pre-existing
-- idx_activity_wallet (wallet_address, created_at DESC) lacks the trailing `id`,
-- so a (created_at, id) tie-break still has to sort. This composite carries the
-- full ordering key so the keyset predicate + ORDER BY are index-resolved.
CREATE INDEX IF NOT EXISTS idx_activity_wallet_keyset
  ON proj_activity (wallet_address, created_at DESC, id DESC);

-- FAILURE-half keyset hot path. The view selects protocol_executions WHERE
-- success = false AND session_id = $sid, ordered by the same (created_at DESC,
-- id DESC) keyset. The partial predicate (WHERE success = false) keeps the index
-- tiny — successful executions (the overwhelming majority) are excluded — and
-- leads with session_id to match the per-session failure scope.
CREATE INDEX IF NOT EXISTS idx_executions_failed_keyset
  ON protocol_executions (session_id, created_at DESC, id DESC)
  WHERE success = false;

-- SUCCESS-half txHash anchor. The view supports a `txHash` lookup that filters
-- BOTH halves by external_refs->>'txHash'. protocol_executions already has
-- idx_executions_tx_hash (migration 001); proj_activity did not, so this partial
-- expression index resolves the success-half txHash anchor without a seq scan.
CREATE INDEX IF NOT EXISTS idx_activity_tx_hash
  ON proj_activity ((external_refs->>'txHash'))
  WHERE external_refs->>'txHash' IS NOT NULL;
