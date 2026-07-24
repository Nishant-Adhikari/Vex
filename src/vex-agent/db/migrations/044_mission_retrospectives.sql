-- Mission retrospectives — one compact, LLM-generated "lessons learned"
-- record per finalized mission RUN. The seed of the self-improving loop:
-- after a mission ends, a single one-shot inference (the same OpenRouter
-- one-shot path the Signals grade uses — NOT the mission turn-loop) reviews
-- the run's outcome, PnL, stop reason, and the executed trades WITH their
-- agent-authored rationales, then emits a structured
-- { summary, wentWell[], wentWrong[], lessons[] } where each lesson is an
-- actionable tweak for the NEXT mission's strategy prompt.
--
-- Generated lazily on first view of the completed-mission card and cached
-- here (fail-soft: if inference is unavailable or malformed the row is simply
-- absent and the card renders without a Retrospective section). Keyed 1:1 on
-- the run so a re-view serves the cached row instead of re-inferring.
--
-- TODO(self-improving-loop): the persisted `lessons_json` is the input a
-- future prompt-revision pass will fold back into the mission setup prompt
-- automatically. Storing it now, decoupled from any consumer, is deliberate.
--
-- The three list columns are JSONB arrays of short strings (bounded in the
-- generator + the IPC schema). `summary` is a bounded paragraph. `model` is
-- the AGENT_MODEL id that produced it (nullable — display/provenance only).

CREATE TABLE mission_retrospectives (
  id                TEXT NOT NULL PRIMARY KEY,
  mission_run_id    TEXT NOT NULL REFERENCES mission_runs(id),
  session_id        TEXT NOT NULL REFERENCES sessions(id),
  summary           TEXT NOT NULL,
  went_well_json    JSONB NOT NULL DEFAULT '[]'::jsonb,
  went_wrong_json   JSONB NOT NULL DEFAULT '[]'::jsonb,
  lessons_json      JSONB NOT NULL DEFAULT '[]'::jsonb,
  model             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Exactly one retrospective per run — generation upserts with
-- ON CONFLICT (mission_run_id) DO NOTHING so two concurrent first-views race
-- harmlessly (the loser no-ops and re-reads the winner's row).
CREATE UNIQUE INDEX mission_retrospectives_run_uidx
  ON mission_retrospectives (mission_run_id);

-- The renderer reads by session id (the post-mission card holds the session,
-- not the run id) — a session maps 1:1 to a run, newest wins.
CREATE INDEX mission_retrospectives_session_idx
  ON mission_retrospectives (session_id, created_at DESC);
