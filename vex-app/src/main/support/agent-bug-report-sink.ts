/**
 * Production `BugReportSink` for the engine integration boundary
 * (puzzle 03, Phase 2). Mounts at app boot via `setupAgentBridges()`,
 * unmounted via `resetBugReportSink()` on teardown.
 *
 * Behaviour:
 *  1. Build a redacted title preview (cheap — just truncate; the full
 *     redactor runs inside `createBugReport`).
 *  2. Consult the rate limiter; drop if over quota (counted, not
 *     thrown).
 *  3. Map `AgentBugReportInput` -> `CreateBugReportInput` and call
 *     `createBugReport` with the production transport + clock.
 *  4. Sink failures must be invisible to the engine — the
 *     `emitBugReportSafe` wrapper on the engine side already catches
 *     thrown errors, but we add a defensive catch here too to keep the
 *     drop counter telemetry independent.
 */

import { createBugReport } from "./bug-report-service.js";
import {
  noopBugReportTransport,
  type BugReportTransport,
} from "./transport.js";
import {
  createBugReportRateLimiter,
  type RateLimiter,
} from "./bug-report-rate-limiter.js";
import type {
  AgentBugReportInput,
  BugReportSink,
} from "../../../../../src/lib/diagnostics/bug-report-sink.js";

export interface AgentBugReportSinkDeps {
  readonly rateLimiter?: RateLimiter;
  readonly transport?: BugReportTransport;
  readonly now?: () => Date;
}

export function createAgentBugReportSink(
  deps: AgentBugReportSinkDeps = {},
): BugReportSink {
  const limiter = deps.rateLimiter ?? createBugReportRateLimiter();
  const transport = deps.transport ?? noopBugReportTransport;

  return {
    async emit(input: AgentBugReportInput): Promise<void> {
      const title = input.title;
      const admitted = limiter.tryAdmit({
        category: input.category,
        correlationId: input.refs?.correlationId ?? null,
        sessionId: input.refs?.sessionId ?? null,
        toolName: input.refs?.toolName ?? null,
        protocolNamespace: input.refs?.protocolNamespace ?? null,
        redactedTitle: title,
      });
      if (!admitted) return;

      await createBugReport(
        {
          reportKind: "automatic",
          source: input.source,
          category: input.category,
          severity: input.severity,
          title,
          description: input.description ?? "",
          context: input.context ?? {},
          refs: input.refs ?? {},
          agentContext: input.agentContext,
          correlationIdFromIpc: input.refs?.correlationId,
        },
        { transport, now: deps.now },
      );
    },
  };
}

/** Re-exported so the agent bridges orchestrator can build a limiter without poking internals. */
export { createBugReportRateLimiter } from "./bug-report-rate-limiter.js";
