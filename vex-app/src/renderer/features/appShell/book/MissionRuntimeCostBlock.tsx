/**
 * RUNTIME & COST — the BOOK panel's mission-run instrument section.
 *
 * Adds a LIVE running-time / time-remaining readout above the existing
 * model/usage/context strip for an active mission run, then the
 * `SessionRuntimeBar` (model · usage · context · compaction) beneath it. The
 * section is collapsible so it can be drilled into alongside the other
 * instruments.
 *
 * Run boundary: `runtime.getState` gives `startedAt` (the run's `started_at`)
 * and the live status. The deadline comes from the mission contract's
 * `constraints.deadlineAt` when a draft is still resolvable; for a run whose
 * draft has already dropped out mid-run the deadline is unknown, and the timer
 * degrades to an elapsed-only readout (never a fabricated countdown).
 */

import type { JSX } from "react";
import { useMissionDraft } from "../../../lib/api/mission.js";
import { useRuntimeState } from "../../../lib/api/runtime.js";
import { MissionRunTimer } from "../MissionRunTimer.js";
import { toEpochMs } from "../missionRunTiming.js";
import { SessionRuntimeBar } from "../SessionRuntimeBar.js";
import { BookBlock } from "./BookBlock.js";

export function MissionRuntimeCostBlock({
  sessionId,
}: {
  readonly sessionId: string;
}): JSX.Element {
  const runtimeQuery = useRuntimeState(sessionId);
  const runtime = runtimeQuery.data?.ok ? runtimeQuery.data.data : null;
  const draftQuery = useMissionDraft(sessionId);
  const draft = draftQuery.data?.ok ? draftQuery.data.data : null;

  const hasActiveRun = runtime?.hasActiveRun === true;
  const startedAtMs = toEpochMs(runtime?.startedAt);
  // The deadline is only known when a draft (with a deadline constraint) is
  // still resolvable — usually only pre-start; mid-run it is null and the
  // timer shows elapsed only.
  const deadlineMs = toEpochMs(draft?.constraints?.deadlineAt ?? null);
  const live = hasActiveRun && runtime?.status === "running";

  return (
    <BookBlock title="Runtime & Cost" collapsible defaultOpen>
      {hasActiveRun && startedAtMs !== null ? (
        <div className="mb-3">
          <MissionRunTimer
            startedAtMs={startedAtMs}
            deadlineMs={deadlineMs}
            live={live}
          />
        </div>
      ) : null}
      <SessionRuntimeBar sessionId={sessionId} layout="stack" />
    </BookBlock>
  );
}
