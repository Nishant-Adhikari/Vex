/**
 * Hard mission deadline — the agent-independent time-box.
 *
 * Missions are meant to run a fixed duration (default 60 min) and auto-stop. The
 * contract's free-text `deadline` proved unreliable (set-but-ignored, prose, or
 * absent), so the hard boundary is computed purely from the run's IMMUTABLE
 * `started_at` + a configured duration — correct across wakes/resumes, and not
 * something the model can talk itself out of. Enforcement lives at the turn-loop
 * boundary (see turn-loop.ts): once `now >= deadline`, the run stops with
 * `deadline_reached` regardless of what the agent is doing.
 *
 * The duration is overridable via `VEX_MISSION_HARD_DEADLINE_MIN` — used to run
 * short (e.g. 2-minute) test boxes without waiting an hour.
 */

const DEFAULT_MINUTES = 60;
const MAX_MINUTES = 1440; // 24h ceiling — a guard against a fat-fingered override

/** Resolve the hard-deadline duration in minutes (default 60, env-overridable). */
export function hardDeadlineMinutes(
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.VEX_MISSION_HARD_DEADLINE_MIN;
  if (raw === undefined || raw === "") return DEFAULT_MINUTES;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MINUTES;
  return Math.min(n, MAX_MINUTES);
}

/**
 * The absolute hard-deadline epoch (ms) for a run: `started_at + duration`.
 * Returns null when `started_at` is unparseable — fail-open, so a bad timestamp
 * never manufactures a spurious deadline that kills a run early.
 */
export function computeHardDeadlineMs(
  startedAtIso: string,
  durationMin: number = hardDeadlineMinutes(),
): number | null {
  const startMs = Date.parse(startedAtIso);
  if (Number.isNaN(startMs)) return null;
  return startMs + durationMin * 60_000;
}
