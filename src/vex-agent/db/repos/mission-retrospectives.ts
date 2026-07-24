/**
 * Mission retrospectives repo — the persisted "lessons learned" record for a
 * finalized mission run (migration 044).
 *
 * One row per run, upserted on first generation with
 * `ON CONFLICT (mission_run_id) DO NOTHING` so two concurrent first-views race
 * harmlessly (the loser no-ops; both then read the winner's row). The reads are
 * keyed on the SESSION (the post-mission card holds the session id, not the run
 * id) — a session maps 1:1 to a run, newest wins.
 *
 * The three list columns are JSONB arrays of short strings; `toRow` coerces
 * defensively (a non-array or non-string entry is dropped) so a hand-edited or
 * legacy row can never crash the read.
 */

import { query, queryOne, execute } from "../client.js";
import { jsonb } from "../params.js";

export interface MissionRetrospectiveRow {
  id: string;
  missionRunId: string;
  sessionId: string;
  summary: string;
  wentWell: string[];
  wentWrong: string[];
  lessons: string[];
  model: string | null;
  createdAt: string;
}

export interface SaveMissionRetrospectiveInput {
  id: string;
  missionRunId: string;
  sessionId: string;
  summary: string;
  wentWell: string[];
  wentWrong: string[];
  lessons: string[];
  model: string | null;
}

interface Raw {
  id: string;
  mission_run_id: string;
  session_id: string;
  summary: string;
  went_well_json: unknown;
  went_wrong_json: unknown;
  lessons_json: unknown;
  model: string | null;
  created_at: Date | string;
}

/** Coerce a JSONB column to a clean `string[]` (drop non-string entries). */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string");
}

function toRow(r: Raw): MissionRetrospectiveRow {
  return {
    id: r.id,
    missionRunId: r.mission_run_id,
    sessionId: r.session_id,
    summary: r.summary,
    wentWell: toStringList(r.went_well_json),
    wentWrong: toStringList(r.went_wrong_json),
    lessons: toStringList(r.lessons_json),
    model: r.model,
    createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
  };
}

const SELECT_COLUMNS = `
  id, mission_run_id, session_id, summary,
  went_well_json, went_wrong_json, lessons_json, model, created_at`;

/**
 * Persist a retrospective. Idempotent: a duplicate for the same run is a no-op
 * (`ON CONFLICT (mission_run_id) DO NOTHING`), so a concurrent first-view never
 * double-writes. Returns nothing — the caller re-reads to serve the canonical
 * (possibly already-present) row.
 */
export async function saveRetrospective(
  input: SaveMissionRetrospectiveInput,
): Promise<void> {
  await execute(
    `INSERT INTO mission_retrospectives (
       id, mission_run_id, session_id, summary,
       went_well_json, went_wrong_json, lessons_json, model
     ) VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8)
     ON CONFLICT (mission_run_id) DO NOTHING`,
    [
      input.id,
      input.missionRunId,
      input.sessionId,
      input.summary,
      jsonb(input.wentWell),
      jsonb(input.wentWrong),
      jsonb(input.lessons),
      input.model,
    ],
  );
}

/** The retrospective for a single run (null when not yet generated). */
export async function getRetrospectiveForRun(
  missionRunId: string,
): Promise<MissionRetrospectiveRow | null> {
  const row = await queryOne<Raw>(
    `SELECT ${SELECT_COLUMNS}
       FROM mission_retrospectives
      WHERE mission_run_id = $1`,
    [missionRunId],
  );
  return row ? toRow(row) : null;
}

/** The newest retrospective for a session (null when none exists). */
export async function getRetrospectiveForSession(
  sessionId: string,
): Promise<MissionRetrospectiveRow | null> {
  const rows = await query<Raw>(
    `SELECT ${SELECT_COLUMNS}
       FROM mission_retrospectives
      WHERE session_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [sessionId],
  );
  return rows.length > 0 ? toRow(rows[0]!) : null;
}
