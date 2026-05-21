/**
 * `BugReportSink` interface — engine-to-vex-app emit boundary (puzzle 03,
 * BUG-REPORTING.md §13.1).
 *
 * Pure / shared lib (no Electron, no DB, no React). Both engine code
 * (`src/vex-agent/...`) and the vex-app main process import this; the
 * vex-app implements the production sink that wraps `createBugReport`,
 * while engine tests + non-app environments use `noopBugReportSink`.
 *
 * `emit` is intentionally fire-and-forget on the agent side via the
 * `emitBugReportSafe` helper — sink failures (DB unavailable, rate
 * limiter rejection, transport drift) MUST NOT propagate back into the
 * engine and alter runtime behavior. The helper logs + drops so an
 * outage of the support pipeline doesn't fail a chat turn.
 */

import type {
  AgentBugReportContext,
  CreateBugReportInput,
} from "./bug-report-schema.js";

/**
 * Input accepted by `BugReportSink.emit`. A reduced shape of
 * `CreateBugReportInput` constrained to agent / worker reports, with
 * `agentContext` always-attached so the sink can stamp Phase 2 columns
 * without re-deriving runtime state from the engine.
 *
 * `reportKind` is implicitly `"automatic"` for everything that flows
 * through here.
 */
export interface AgentBugReportInput {
  readonly source: Extract<CreateBugReportInput["source"], "agent" | "worker">;
  readonly category: string;
  readonly severity: CreateBugReportInput["severity"];
  readonly title: string;
  readonly description?: string;
  readonly refs?: CreateBugReportInput["refs"];
  readonly context?: CreateBugReportInput["context"];
  readonly agentContext?: AgentBugReportContext;
}

export interface BugReportSink {
  emit(input: AgentBugReportInput): Promise<void>;
}

/**
 * No-op default. Engine code reads through `getBugReportSink()` and
 * falls back to this until the vex-app boot wires the production sink
 * via `setBugReportSink(...)`.
 */
export const noopBugReportSink: BugReportSink = {
  async emit(): Promise<void> {
    return undefined;
  },
};

/**
 * Fail-closed wrapper. Sinks called from engine emit points MUST be
 * called through this helper so a sink throw, rate-limit reject, or DB
 * outage cannot propagate into the runtime path. The error is logged
 * (via the passed logger) and dropped.
 *
 * Returns once the sink resolves or rejects — never throws.
 */
export async function emitBugReportSafe(
  sink: BugReportSink,
  input: AgentBugReportInput,
  logger: {
    warn: (message: string, meta?: Record<string, unknown>) => void;
  },
): Promise<void> {
  try {
    await sink.emit(input);
  } catch (err) {
    logger.warn("bug-report.sink.emit_failed", {
      category: input.category,
      severity: input.severity,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
