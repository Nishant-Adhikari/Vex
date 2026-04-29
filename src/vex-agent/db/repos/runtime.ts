/**
 * Runtime repo — wrapper for runtime_state (singleton) and runtime_cycles (audit).
 *
 * Global process state ONLY — not per-run state (that's in mission_runs).
 * runtime_state tracks: is the main loop active? what mode? which session?
 * runtime_cycles tracks: cycle audit trail (start, end, phases, outcome).
 */

import { query, queryOne, execute } from "../client.js";

// ── Types ───────────────────────────────────────────────────────

export interface RuntimeState {
  active: boolean;
  mode: string;
  intervalMs: number;
  currentPhase: string;
  phaseStartedAt: string | null;
  loopSessionId: string | null;
  startedAt: string | null;
  lastCycleAt: string | null;
  cycleCount: number;
}

function mapStateRow(r: Record<string, unknown>): RuntimeState {
  return {
    active: r.active as boolean,
    mode: r.mode as string,
    intervalMs: (r.interval_ms as number) ?? 300000,
    currentPhase: (r.current_phase as string) ?? "idle",
    phaseStartedAt: r.phase_started_at ? (r.phase_started_at instanceof Date ? r.phase_started_at.toISOString() : r.phase_started_at as string) : null,
    loopSessionId: r.loop_session_id as string | null,
    startedAt: r.started_at ? (r.started_at instanceof Date ? r.started_at.toISOString() : r.started_at as string) : null,
    lastCycleAt: r.last_cycle_at ? (r.last_cycle_at instanceof Date ? r.last_cycle_at.toISOString() : r.last_cycle_at as string) : null,
    cycleCount: (r.cycle_count as number) ?? 0,
  };
}

// ── State operations ────────────────────────────────────────────

export async function getState(): Promise<RuntimeState> {
  const row = await queryOne<Record<string, unknown>>(
    "SELECT * FROM runtime_state WHERE id = 1",
  );
  if (!row) {
    return { active: false, mode: "restricted", intervalMs: 300000, currentPhase: "idle", phaseStartedAt: null, loopSessionId: null, startedAt: null, lastCycleAt: null, cycleCount: 0 };
  }
  return mapStateRow(row);
}

export async function setActiveLoop(
  mode: string,
  intervalMs: number,
  sessionId: string,
): Promise<void> {
  await execute(
    `UPDATE runtime_state SET active = TRUE, mode = $1, interval_ms = $2,
     loop_session_id = $3, started_at = NOW(), current_phase = 'idle',
     phase_started_at = NOW() WHERE id = 1`,
    [mode, intervalMs, sessionId],
  );
}

export async function updatePhase(phase: string): Promise<void> {
  await execute(
    "UPDATE runtime_state SET current_phase = $1, phase_started_at = NOW() WHERE id = 1",
    [phase],
  );
}

export async function stopLoop(): Promise<void> {
  await execute(
    "UPDATE runtime_state SET active = FALSE, current_phase = 'idle', phase_started_at = NULL WHERE id = 1",
  );
}

// ── Cycle operations ────────────────────────────────────────────

export async function recordCycleStart(cycleNumber: number): Promise<number> {
  const row = await queryOne<{ id: number }>(
    "INSERT INTO runtime_cycles (cycle_number, started_at) VALUES ($1, NOW()) RETURNING id",
    [cycleNumber],
  );
  return row?.id ?? 0;
}

export async function recordCycleEnd(
  cycleId: number,
  phasesCompleted: string[],
  outcome: string,
  errorMessage?: string,
): Promise<void> {
  await execute(
    `UPDATE runtime_cycles SET ended_at = NOW(), phases_completed = $1,
     outcome = $2, error_message = $3 WHERE id = $4`,
    [phasesCompleted, outcome, errorMessage ?? null, cycleId],
  );

  // Update runtime_state cycle bookkeeping
  if (outcome === "completed") {
    await execute(
      "UPDATE runtime_state SET last_cycle_at = NOW(), cycle_count = cycle_count + 1 WHERE id = 1",
    );
  }
}
