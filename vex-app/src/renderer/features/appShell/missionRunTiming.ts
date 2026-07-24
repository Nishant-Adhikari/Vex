/**
 * Mission-run timing — PURE derivations for the mission-detail panel's live
 * "running time / time remaining" readout. Kept free of React/IPC so the math
 * is unit-tested in isolation (jsdom-free, node env).
 *
 * Inputs are the run-boundary facts the renderer already has:
 *   - `startedAtMs` — the run's `started_at` (runtime.getState → startedAt).
 *   - `deadlineMs`  — the run's deadline, when known (the mission contract's
 *     `constraints.deadlineAt`, derived from the SAME frozen `durationMinutes`
 *     the engine deadline uses). `null` when unavailable (e.g. a live run whose
 *     draft has dropped out) — the caller then shows elapsed only.
 *
 * Both `elapsedMs` and `remainingMs` are clamped at 0 (a clock skew or a
 * deadline already passed never yields a negative duration). `remainingMs` is
 * `null` exactly when no deadline is known.
 */

export interface MissionRunTiming {
  /** Wall-clock ms since the run started (>= 0). */
  readonly elapsedMs: number;
  /** Ms until the deadline (>= 0), or `null` when no deadline is known. */
  readonly remainingMs: number | null;
  /** `true` once a known deadline has passed (remaining hit 0). */
  readonly overdue: boolean;
  /** Fraction [0,1] of the run window consumed, or `null` without a deadline. */
  readonly fractionElapsed: number | null;
}

/**
 * Compute the run timing from the run boundary and a `now` clock.
 *
 * @param startedAtMs run start epoch ms (must be a finite number).
 * @param deadlineMs  deadline epoch ms, or `null` when unknown.
 * @param nowMs       current epoch ms (injected so callers/tests control it).
 */
export function computeMissionRunTiming(
  startedAtMs: number,
  deadlineMs: number | null,
  nowMs: number,
): MissionRunTiming {
  const elapsedMs = Math.max(0, nowMs - startedAtMs);
  if (deadlineMs === null || !Number.isFinite(deadlineMs)) {
    return {
      elapsedMs,
      remainingMs: null,
      overdue: false,
      fractionElapsed: null,
    };
  }
  const remainingMs = Math.max(0, deadlineMs - nowMs);
  const windowMs = Math.max(0, deadlineMs - startedAtMs);
  const fractionElapsed =
    windowMs > 0 ? Math.min(1, Math.max(0, elapsedMs / windowMs)) : 1;
  return {
    elapsedMs,
    remainingMs,
    overdue: remainingMs <= 0,
    fractionElapsed,
  };
}

/**
 * Format a duration in ms as a compact `H:MM:SS` (or `M:SS` under an hour)
 * clock — the mono tabular readout the detail panel ticks. Negative inputs
 * clamp to `0:00`.
 */
export function formatDurationClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  if (hours > 0) {
    return `${hours}:${mm}:${ss}`;
  }
  return `${minutes}:${ss}`;
}

/**
 * Parse an ISO-8601 timestamp to epoch ms, or `null` when absent/unparseable.
 * A fail-soft helper for the optional `startedAt` / `deadlineAt` strings the
 * runtime + contract DTOs carry.
 */
export function toEpochMs(iso: string | null | undefined): number | null {
  if (iso === null || iso === undefined) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}
