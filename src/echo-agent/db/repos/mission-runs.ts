/**
 * Mission runs repo — per-run state persistence.
 *
 * NO parent_run_id — session_links is the canonical relationship graph.
 * Run status is the source of truth for per-run state (not runtime_state).
 */

import type { LoopMode } from "../../engine/types.js";
import { query, queryOne, execute } from "../client.js";

// ── Types ───────────────────────────────────────────────────────

export interface MissionRun {
  id: string;
  missionId: string;
  sessionId: string;
  status: string;
  loopMode: LoopMode;
  startedAt: string;
  endedAt: string | null;
  lastCheckpointAt: string | null;
  stopReason: string | null;
  stopSummary: string | null;
  stopEvidenceJson: Record<string, unknown> | null;
  iterationCount: number;
}

// DB stores `loop_mode` as TEXT without a CHECK constraint. Narrow at the
// repo boundary so callers get a typed domain value and never need `as any`.
// Unknown values fall back to the safest mode ("off") rather than throwing —
// a mission with a typo in loop_mode should degrade, not crash the loop.
const ALLOWED_LOOP_MODES = ["off", "restricted", "full"] as const;

function coerceLoopMode(raw: unknown): LoopMode {
  if (typeof raw !== "string") return "off";
  return (ALLOWED_LOOP_MODES as readonly string[]).includes(raw) ? (raw as LoopMode) : "off";
}

function mapRow(r: Record<string, unknown>): MissionRun {
  return {
    id: r.id as string,
    missionId: r.mission_id as string,
    sessionId: r.session_id as string,
    status: r.status as string,
    loopMode: coerceLoopMode(r.loop_mode),
    startedAt: (r.started_at instanceof Date ? r.started_at.toISOString() : r.started_at as string),
    endedAt: r.ended_at ? (r.ended_at instanceof Date ? r.ended_at.toISOString() : r.ended_at as string) : null,
    lastCheckpointAt: r.last_checkpoint_at ? (r.last_checkpoint_at instanceof Date ? r.last_checkpoint_at.toISOString() : r.last_checkpoint_at as string) : null,
    stopReason: r.stop_reason as string | null,
    stopSummary: r.stop_summary as string | null,
    stopEvidenceJson: r.stop_evidence_json as Record<string, unknown> | null,
    iterationCount: (r.iteration_count as number) ?? 0,
  };
}

// ── CRUD ────────────────────────────────────────────────────────

export async function createRun(
  id: string,
  missionId: string,
  sessionId: string,
  loopMode: string,
): Promise<void> {
  await execute(
    "INSERT INTO mission_runs (id, mission_id, session_id, loop_mode) VALUES ($1, $2, $3, $4)",
    [id, missionId, sessionId, loopMode],
  );
}

export async function updateStatus(
  id: string,
  status: string,
  stopReason?: string,
  stopPayload?: { summary?: string; evidence?: Record<string, unknown> },
): Promise<void> {
  const ended = (status !== "running" && status !== "paused_approval" && status !== "paused_checkpoint")
    ? "NOW()" : "ended_at";
  await execute(
    `UPDATE mission_runs SET status = $1, stop_reason = COALESCE($2, stop_reason),
     stop_summary = COALESCE($3, stop_summary),
     stop_evidence_json = COALESCE($4, stop_evidence_json),
     ended_at = ${ended} WHERE id = $5`,
    [
      status, stopReason ?? null,
      stopPayload?.summary ?? null,
      stopPayload?.evidence ? JSON.stringify(stopPayload.evidence) : null,
      id,
    ],
  );
}

export async function setLastCheckpoint(id: string): Promise<void> {
  await execute(
    "UPDATE mission_runs SET last_checkpoint_at = NOW() WHERE id = $1",
    [id],
  );
}

export async function incrementIterations(id: string): Promise<number> {
  const row = await queryOne<{ iteration_count: number }>(
    "UPDATE mission_runs SET iteration_count = iteration_count + 1 WHERE id = $1 RETURNING iteration_count",
    [id],
  );
  return row?.iteration_count ?? 0;
}

export async function getActiveRun(missionId: string): Promise<MissionRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM mission_runs WHERE mission_id = $1 AND status IN ('running', 'paused_approval', 'paused_checkpoint') ORDER BY started_at DESC LIMIT 1",
    [missionId],
  );
  return row ? mapRow(row) : null;
}

export async function getRun(id: string): Promise<MissionRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM mission_runs WHERE id = $1",
    [id],
  );
  return row ? mapRow(row) : null;
}

export async function getRunBySession(sessionId: string): Promise<MissionRun | null> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM mission_runs WHERE session_id = $1 ORDER BY started_at DESC LIMIT 1",
    [sessionId],
  );
  return row ? mapRow(row) : null;
}
