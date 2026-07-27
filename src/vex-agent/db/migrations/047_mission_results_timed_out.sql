-- Mission results — allow the `timed_out` outcome.
--
-- A run stopped by the hard-deadline enforcer (`stop_reason='deadline_reached'`)
-- is a clean TIME-BOX end, not a failure. The finalize path records the ledger
-- `outcome` as `timed_out` so the results card / History / session panel read
-- "TIMED OUT" instead of the alarming "FAILED" (the mislabel a live Mission #2
-- showed after it merely ran out its hour).
--
-- Migration 041 pinned the CHECK constraint to a closed set that omitted
-- `timed_out`, so the finalize write would have been rejected by the DB. Widen
-- the constraint to include it. The run/mission STATUS enums are unaffected —
-- this relabels only the operator-facing ledger outcome.

ALTER TABLE mission_results
  DROP CONSTRAINT IF EXISTS mission_results_outcome_check;

ALTER TABLE mission_results
  ADD CONSTRAINT mission_results_outcome_check
    CHECK (outcome IN ('running', 'completed', 'cancelled', 'failed', 'stopped', 'timed_out'));
