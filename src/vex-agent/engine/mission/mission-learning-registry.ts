/**
 * Engine-side MissionLearningSink registry — the seam the self-improving loop
 * hangs off the mission finalize path.
 *
 * Mirrors `bug-report-registry` / the transcript event bus: the engine's
 * finalize code calls `getMissionLearningSink().onMissionFinalized(...)` through
 * this singleton, and the vex-app main process installs the production sink once
 * at boot (`setMissionLearningSink(...)` in `setupAgentBridges`). Until then the
 * default is a no-op, so the engine stays inert in tests and headless contexts.
 *
 * The sink is where the heavy, main-process-only work lives (retrospective
 * banking + the one-shot rewriter/judge that need the vault-injected OpenRouter
 * env). Keeping it behind this registry preserves the layering — the engine
 * never imports vex-app/main — and keeps the finalize path fully fail-soft: the
 * finalize call site fires the sink WITHOUT awaiting and swallows any error, so
 * a slow or failing learning pass can never delay or break mission finalize.
 */

export interface MissionFinalizedEvent {
  readonly missionId: string;
  readonly runId: string;
  readonly sessionId: string;
  /** Terminal ledger outcome (completed / failed / cancelled / timed_out / stopped). */
  readonly outcome: string;
  readonly stopReason: string | null;
}

export interface MissionLearningSink {
  /**
   * Called once per terminal mission finalize. Implementations MUST be fully
   * self-contained and fail-soft — the caller does not await and ignores errors.
   */
  onMissionFinalized(event: MissionFinalizedEvent): Promise<void>;
}

const noopSink: MissionLearningSink = {
  async onMissionFinalized(): Promise<void> {
    /* inert until vex-app boot installs the real sink */
  },
};

let currentSink: MissionLearningSink = noopSink;

/** Read the installed sink. The finalize path calls this. */
export function getMissionLearningSink(): MissionLearningSink {
  return currentSink;
}

/** Install the production sink. Idempotent — last writer wins. */
export function setMissionLearningSink(sink: MissionLearningSink): void {
  currentSink = sink;
}

/** Restore the no-op default. Tests use this in `afterEach`. */
export function resetMissionLearningSink(): void {
  currentSink = noopSink;
}
