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
 * Resolve the box duration for a specific mission: the mission's own
 * `durationMinutes` (a structured contract field the agent sets — "5-minute box"
 * → 5, "one hour" → 60) when present and valid, else the env override, else the
 * 60-minute default. So each mission runs for as long as IT asked, and 60 is a
 * true last-resort fallback rather than a one-size-fits-all box.
 */
export function resolveDurationMinutes(
  missionMinutes?: number | null,
  env: Record<string, string | undefined> = process.env,
): number {
  if (
    typeof missionMinutes === "number" &&
    Number.isFinite(missionMinutes) &&
    missionMinutes > 0
  ) {
    return Math.min(missionMinutes, MAX_MINUTES);
  }
  return hardDeadlineMinutes(env);
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

/**
 * The frozen box duration for a run, read from its IMMUTABLE contract snapshot
 * (`contract_snapshot_json.frozenMission`). The snapshot is captured at start
 * and never drifts, so it is the correct duration source for an agent-
 * independent enforcement path (unlike the live mission row, which can move
 * back to draft/edit). Prefers the raw `constraintsJson.durationMinutes`, then
 * the projected `draft.durationMinutes`; returns null when neither is present.
 */
function frozenDurationMinutes(
  contractSnapshotJson: Record<string, unknown> | null | undefined,
): number | null {
  const frozen = (contractSnapshotJson as { frozenMission?: unknown } | null | undefined)
    ?.frozenMission as
    | { constraintsJson?: Record<string, unknown>; draft?: Record<string, unknown> }
    | undefined;
  const fromConstraints = frozen?.constraintsJson?.durationMinutes;
  if (typeof fromConstraints === "number" && Number.isFinite(fromConstraints) && fromConstraints > 0) {
    return fromConstraints;
  }
  const fromDraft = frozen?.draft?.durationMinutes;
  if (typeof fromDraft === "number" && Number.isFinite(fromDraft) && fromDraft > 0) {
    return fromDraft;
  }
  return null;
}

/**
 * Central resolver: the hard-deadline epoch (ms) for a run ROW — its immutable
 * `startedAt` + the frozen box duration (→ env override → 60-min default). This
 * is the single source of truth the agent-independent watchdog (deadline sweep)
 * consults for a parked run, mirroring the loop-boundary computation but reading
 * the duration from the run's frozen snapshot instead of a live hydrate.
 *
 * Fail-open: an unparseable `startedAt` yields null (no box) rather than a false
 * early stop — the same contract as `computeHardDeadlineMs`.
 */
export function resolveRunHardDeadlineMs(
  run: { startedAt: string; contractSnapshotJson: Record<string, unknown> | null },
  env: Record<string, string | undefined> = process.env,
): number | null {
  const durationMin = resolveDurationMinutes(
    frozenDurationMinutes(run.contractSnapshotJson),
    env,
  );
  return computeHardDeadlineMs(run.startedAt, durationMin);
}
