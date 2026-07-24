/**
 * MISSION CONTROL header — the BOOK panel's run-status block: the active run's
 * identity + state at a glance, elevated above the instrument sections.
 *
 * Renders (mission sessions only — returns null for agent sessions):
 *   - mission identity: `#<seqNo> · <name>` (session title → goal snippet),
 *   - a status pill (RUNNING / PAUSED / paused_error / …) toned by run state
 *     with a live pulse while running,
 *   - RUNNING TIME + TIME LEFT + a thin progress bar (the `MissionRunTimer`,
 *     lifted out of RUNTIME & COST). TIME LEFT counts down to the run's
 *     `deadlineAt` — now surfaced by `runtime.getState` (derived from the frozen
 *     contract), so it works for a live run whose draft has dropped out. No
 *     deadline → elapsed-only (fail-soft, never NaN).
 *
 * Pure presentation over existing read hooks; the timing + pill math live in
 * `missionRunTiming` / `missionControlModel` and are unit-tested without React.
 */

import type { JSX } from "react";
import { useMissionSessionResult } from "../../../lib/api/mission.js";
import { useRuntimeState } from "../../../lib/api/runtime.js";
import { useSession } from "../../../lib/api/sessions.js";
import { cn } from "../../../lib/utils.js";
import { MissionRunTimer } from "../MissionRunTimer.js";
import { toEpochMs } from "../missionRunTiming.js";
import {
  deriveMissionName,
  deriveRunStatusPill,
  type RunPillTone,
} from "../missionControlModel.js";

/** tone → pill classes. Muted tinted chip, tone-coloured text + dot. */
const PILL_TONE: Record<RunPillTone, string> = {
  running:
    "bg-[var(--color-success)]/12 text-[var(--color-success)] border-[var(--color-success)]/30",
  paused:
    "bg-warning/10 text-[var(--vex-warn-text)] border-[var(--vex-warn-text)]/30",
  error:
    "bg-[var(--color-destructive)]/12 text-[var(--color-destructive)] border-[var(--color-destructive)]/30",
  done: "bg-[var(--vex-accent)]/10 text-[var(--vex-accent-text)] border-[var(--vex-accent)]/30",
  idle: "bg-white/[0.04] text-[var(--vex-text-3)] border-[var(--vex-line)]",
};

const DOT_TONE: Record<RunPillTone, string> = {
  running: "bg-[var(--color-success)]",
  paused: "bg-[var(--vex-warn-text)]",
  error: "bg-[var(--color-destructive)]",
  done: "bg-[var(--vex-accent)]",
  idle: "bg-[var(--vex-text-3)]",
};

export function MissionControlHeader({
  sessionId,
}: {
  readonly sessionId: string;
}): JSX.Element | null {
  const sessionQuery = useSession(sessionId);
  const session = sessionQuery.data?.ok ? sessionQuery.data.data : null;
  const resultQuery = useMissionSessionResult(sessionId);
  const missionResult = resultQuery.data?.ok ? resultQuery.data.data : null;
  const runtimeQuery = useRuntimeState(sessionId);
  const runtime = runtimeQuery.data?.ok ? runtimeQuery.data.data : null;

  // Gate: this is a MISSION-mode instrument. An agent session gets no header
  // (BookPanel keeps its POSITION-first layout unchanged).
  if (session !== null && session.mode !== "mission") return null;

  const pill = deriveRunStatusPill(
    runtime?.status ?? null,
    runtime?.hasActiveRun === true,
  );
  const name = deriveMissionName(session?.title, missionResult?.goalSnippet);
  const seqNo = missionResult?.seqNo ?? null;

  const hasActiveRun = runtime?.hasActiveRun === true;
  const startedAtMs = toEpochMs(runtime?.startedAt);
  // Deadline now travels on the runtime DTO (frozen-contract derived), so TIME
  // LEFT ticks even after the draft drops out mid-run. Null → elapsed only.
  const deadlineMs = toEpochMs(runtime?.deadlineAt);
  const live = hasActiveRun && runtime?.status === "running";

  return (
    <section
      data-vex-area="mission-control-header"
      className="border-b border-[var(--vex-line)] pb-4"
    >
      <div className="mb-2 flex items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="vex-eyebrow">Mission Control</span>
          <span className="flex min-w-0 items-baseline gap-1.5">
            {seqNo !== null ? (
              <span className="shrink-0 font-mono text-[11px] tabular-nums text-[var(--vex-text-3)]">
                #{seqNo}
              </span>
            ) : null}
            <span
              className="min-w-0 truncate text-[13px] font-medium text-[var(--vex-text)]"
              title={name}
            >
              {name}
            </span>
          </span>
        </div>
        <span
          data-vex-area="run-status-pill"
          data-tone={pill.tone}
          className={cn(
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5",
            "font-mono text-[10px] uppercase tracking-[0.14em]",
            PILL_TONE[pill.tone],
          )}
        >
          <span
            aria-hidden
            className={cn(
              "h-1.5 w-1.5 shrink-0 rounded-full",
              DOT_TONE[pill.tone],
              pill.pulse ? "vex-pulse-dot" : "",
            )}
          />
          {pill.label}
        </span>
      </div>

      {hasActiveRun && startedAtMs !== null ? (
        <MissionRunTimer
          startedAtMs={startedAtMs}
          deadlineMs={deadlineMs}
          live={live}
        />
      ) : null}
    </section>
  );
}
