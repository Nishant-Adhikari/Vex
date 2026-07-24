/**
 * MissionRunTimer — the mission-detail panel's LIVE running-time readout.
 *
 * Ticks once a second (only while a run is genuinely live) and renders:
 *   - RUNNING TIME — wall-clock elapsed since the run's `started_at`.
 *   - TIME LEFT    — countdown to the run deadline, when a deadline is known
 *     (the mission contract's `constraints.deadlineAt`, from the same frozen
 *     `durationMinutes` the engine deadline uses). Omitted when unknown.
 *
 * A small live pulse marks a running run so the operator can always tell the
 * mission is in-flight from the detail panel (mirrors the SessionsList row's
 * pulse + the ActiveMissionsBar dot). Pure presentation over props — the run
 * boundary (startedAt/deadline/live) is resolved by the caller — so the timing
 * math (`missionRunTiming`) stays unit-tested without React.
 */

import { useEffect, useRef, useState, type JSX } from "react";
import { cn } from "../../lib/utils.js";
import {
  computeMissionRunTiming,
  formatDurationClock,
} from "./missionRunTiming.js";

export interface MissionRunTimerProps {
  /** Run start epoch ms (runtime.getState → startedAt). `null` → render nothing. */
  readonly startedAtMs: number | null;
  /** Deadline epoch ms, or `null` when unknown (elapsed-only). */
  readonly deadlineMs: number | null;
  /**
   * Whether the run is live (running). Drives the pulse + whether the clock
   * ticks: a parked/paused run freezes the readout (no per-second churn) but
   * still shows the elapsed/remaining snapshot.
   */
  readonly live: boolean;
  /** Injected clock for tests; defaults to `Date.now`. */
  readonly now?: () => number;
}

export function MissionRunTimer({
  startedAtMs,
  deadlineMs,
  live,
  now = Date.now,
}: MissionRunTimerProps): JSX.Element | null {
  const [nowMs, setNowMs] = useState<number>(() => now());
  // Keep the latest `now` getter without retriggering the interval effect.
  const nowRef = useRef(now);
  nowRef.current = now;

  useEffect(() => {
    // Only a live run needs to tick; a frozen (paused) readout would just
    // re-render identically every second.
    if (!live) return undefined;
    setNowMs(nowRef.current());
    const id = setInterval(() => setNowMs(nowRef.current()), 1000);
    return () => clearInterval(id);
  }, [live]);

  if (startedAtMs === null) return null;

  const timing = computeMissionRunTiming(startedAtMs, deadlineMs, nowMs);
  const remaining = timing.remainingMs;

  return (
    <div
      data-vex-area="mission-run-timer"
      className="flex w-full flex-col gap-1.5"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-[var(--vex-text-3)]">
          {live ? (
            <span
              role="img"
              aria-label="Mission running"
              className="vex-pulse-dot h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-success)]"
            />
          ) : null}
          Running time
        </span>
        <span className="font-mono text-[12px] tabular-nums text-[var(--vex-text)]">
          {formatDurationClock(timing.elapsedMs)}
        </span>
      </div>

      {remaining !== null ? (
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "font-mono text-[10px] uppercase tracking-[0.16em]",
              timing.overdue
                ? "text-[var(--vex-warn-text)]"
                : "text-[var(--vex-text-3)]",
            )}
          >
            {timing.overdue ? "Deadline passed" : "Time left"}
          </span>
          <span
            className={cn(
              "font-mono text-[12px] tabular-nums",
              timing.overdue
                ? "text-[var(--vex-warn-text)]"
                : "text-[var(--vex-text)]",
            )}
          >
            {formatDurationClock(remaining)}
          </span>
        </div>
      ) : null}

      {timing.fractionElapsed !== null ? (
        <span
          aria-hidden
          className="relative h-1 w-full overflow-hidden rounded-full bg-white/[0.12]"
        >
          <span
            className={cn(
              "absolute inset-y-0 left-0 rounded-full",
              timing.overdue
                ? "bg-[var(--vex-warn-text)]"
                : "bg-[var(--vex-accent)]",
            )}
            style={{ width: `${Math.round(timing.fractionElapsed * 100)}%` }}
          />
        </span>
      ) : null}
    </div>
  );
}
