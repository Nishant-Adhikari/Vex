-- Operator interrupts and mission run recovery.

ALTER TABLE mission_runs
  ADD COLUMN contract_snapshot_json JSONB,
  ADD COLUMN recovered_from_run_id TEXT NULL REFERENCES mission_runs(id);

CREATE INDEX idx_mission_runs_recovered_from
  ON mission_runs(recovered_from_run_id)
  WHERE recovered_from_run_id IS NOT NULL;
