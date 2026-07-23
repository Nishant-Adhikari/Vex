/**
 * Active-missions model — the PURE classification that powers the persistent
 * "Active missions" bar (a read-only observability surface).
 *
 * The safety problem it solves: the app only ever shows the FOCUSED session's
 * run status. If a second run is live in another session — or a run orphans
 * (its `mission_results` row is stuck at `outcome='running'` with no
 * `ended_at` because the run crashed/was killed) — the operator loses track of
 * an open, possibly real-money position. This model takes the per-wallet
 * ledger's still-"running" rows and cross-references each against that
 * session's LIVE runtime state to split genuinely-live runs from
 * stale/orphaned ledger rows that only LOOK live.
 *
 * All of the heuristics live here as a pure function so they can be unit
 * tested without React or IPC. The hook (`useActiveMissions`) is a thin
 * data-plumbing shell over this.
 */

import type { MissionResultDto } from "@shared/schemas/mission.js";
import type { MissionRunStatus } from "@shared/schemas/sessions.js";

/**
 * Display status for one active-mission entry:
 *  - `running`        — a live run whose runner is executing.
 *  - `preparing`      — a live run row exists but hasn't reached `running`
 *                       (defensive edge; the engine has no dedicated status).
 *  - `paused`         — a live run parked on approval / wake / error / user.
 *  - `stale_orphaned` — the ledger still says `running` but runtime confirms
 *                       NO active run for the session. The row is stranded and
 *                       needs cleanup; it must never masquerade as live.
 */
export type ActiveMissionStatus =
  | "running"
  | "preparing"
  | "paused"
  | "stale_orphaned";

/** The slice of `RuntimeStateDto` this model reads for classification. */
export interface ActiveMissionRuntime {
  readonly hasActiveRun: boolean;
  readonly status: MissionRunStatus | null;
}

export interface ActiveMission {
  readonly missionRunId: string;
  readonly sessionId: string;
  readonly seqNo: number;
  /** Best available human label — session title, else goal snippet, else `#N`. */
  readonly label: string;
  readonly status: ActiveMissionStatus;
  readonly pnlEth: number | null;
  readonly pnlPct: number | null;
  readonly openPositionsCount: number;
}

/**
 * Map a live run's `mission_runs.status` to a bar status. `hasActiveRun` has
 * already proven the run is live by the time this is called, so a terminal or
 * null status here is an inconsistent edge → treat as `preparing` (neutral),
 * never as orphaned (which would wrongly imply "no live run").
 */
function classifyLiveStatus(status: MissionRunStatus | null): ActiveMissionStatus {
  switch (status) {
    case "running":
      return "running";
    case "paused_approval":
    case "paused_wake":
    case "paused_error":
    case "paused_user":
    case "paused_plan_acceptance":
      return "paused";
    default:
      // completed / failed / stopped / cancelled / null — inconsistent with a
      // live run, but not evidence of an orphan. Surface it neutrally.
      return "preparing";
  }
}

function deriveLabel(
  title: string | null | undefined,
  goalSnippet: string | null,
  seqNo: number,
): string {
  const t = title?.trim();
  if (t) return t;
  const g = goalSnippet?.trim();
  if (g) return g;
  return `Mission #${seqNo}`;
}

/**
 * Attention order — the stranded/unattended rows the operator most needs to
 * see come first (a stale-orphaned row may be holding a bag with nobody
 * watching), then paused, then the healthy live runs.
 */
const STATUS_ORDER: Record<ActiveMissionStatus, number> = {
  stale_orphaned: 0,
  paused: 1,
  running: 2,
  preparing: 3,
};

/**
 * Classify the still-open ledger rows into the bar's entries.
 *
 * @param ledger           per-wallet ledger rows (any outcome; filtered here).
 * @param runtimeBySession resolved runtime state per session. A KEY PRESENT
 *   means runtime resolved for that session; ABSENT (`undefined`) means the
 *   runtime read hasn't resolved yet (loading / transport error). An unresolved
 *   read is treated as an UNVERIFIED live run (shown `running`), NOT orphaned —
 *   we never flash "orphaned" before runtime has actually confirmed no live
 *   run, which would needlessly alarm the operator about a healthy run.
 * @param labelBySession   optional session id → display title/goal.
 */
export function classifyActiveMissions(
  ledger: readonly MissionResultDto[],
  runtimeBySession: ReadonlyMap<string, ActiveMissionRuntime>,
  labelBySession?: ReadonlyMap<string, string | null>,
): ActiveMission[] {
  const open = ledger.filter((r) => r.outcome === "running");

  const items: ActiveMission[] = open.map((r) => {
    const runtime = runtimeBySession.get(r.sessionId);
    let status: ActiveMissionStatus;
    if (runtime === undefined) {
      // Runtime not yet resolved — trust the ledger's "running" tentatively.
      status = "running";
    } else if (!runtime.hasActiveRun) {
      // Ledger says running, runtime says no active run → orphaned.
      status = "stale_orphaned";
    } else {
      status = classifyLiveStatus(runtime.status);
    }
    return {
      missionRunId: r.missionRunId,
      sessionId: r.sessionId,
      seqNo: r.seqNo,
      label: deriveLabel(labelBySession?.get(r.sessionId), r.goalSnippet, r.seqNo),
      status,
      pnlEth: r.pnlEth,
      pnlPct: r.pnlPct,
      openPositionsCount: r.openPositionsCount,
    };
  });

  return items.sort((a, b) => {
    const byStatus = STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    if (byStatus !== 0) return byStatus;
    return b.seqNo - a.seqNo; // newest first within a status band
  });
}
