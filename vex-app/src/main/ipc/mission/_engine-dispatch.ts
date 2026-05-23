/**
 * Background dispatch helper for `mission.start` and `mission.recover`.
 *
 * Both commands prepare a durable `mission_runs` row synchronously
 * (`prepareMissionStart` / `prepareMissionRecover` open the lease +
 * commit the atomic gate before the IPC handler returns
 * `dispatched`). The actual turn loop runs in the background; this
 * helper wraps the long-running call with:
 *
 *   - structured log on continuation failure
 *   - bug-report sink emit so observability picks up provider-side
 *     failures even though the lease release / status finalize lives
 *     inside the engine helper (`runPreparedMission{Start,Recover}`
 *     handle their own `finalizeMissionRunError`).
 *
 * Per puzzle 04 phase 6 codex review #3: no dedicated audit table for
 * mission start/recover — the `mission_runs` row IS the durable
 * dispatch record. This helper provides observability without changing
 * the run lifecycle.
 */

import { log } from "../../logger/index.js";

export interface DispatchRefs {
  readonly sessionId: string;
  readonly missionId?: string;
  readonly missionRunId?: string;
  readonly correlationId: string;
  readonly channelLabel: string;
}

/**
 * Run a prepared engine continuation (e.g. `runPreparedMissionStart`,
 * `runPreparedMissionRecover`) in the background and emit a bug report
 * on failure. The continuation owns its own lease release.
 */
export function dispatchPreparedMission(
  continuation: () => Promise<unknown>,
  refs: DispatchRefs,
): void {
  void (async () => {
    try {
      await continuation();
    } catch (cause) {
      log.warn(
        `[ipc:${refs.channelLabel}] continuation failed ` +
          `sessionId=${refs.sessionId} runId=${refs.missionRunId ?? "<unknown>"} ` +
          `correlationId=${refs.correlationId}`,
        cause,
      );
      try {
        const { getBugReportSink } = await import(
          "@vex-agent/engine/support/bug-report-registry.js"
        );
        const { emitBugReportSafe } = await import(
          "@vex-lib/diagnostics/bug-report-sink.js"
        );
        await emitBugReportSafe(
          getBugReportSink(),
          {
            source: "agent",
            category: "mission_system_error",
            severity: "error",
            title: `${refs.channelLabel}.continuation_failed`,
            description:
              cause instanceof Error ? cause.message : String(cause),
            refs: {
              sessionId: refs.sessionId,
              ...(refs.missionId !== undefined
                ? { missionId: refs.missionId }
                : {}),
              ...(refs.missionRunId !== undefined
                ? { missionRunId: refs.missionRunId }
                : {}),
              correlationId: refs.correlationId,
            },
            agentContext: { runtimeStatus: "running" },
          },
          log,
        );
      } catch {
        // Bug-report sink itself unreachable — the log above is the
        // observability fallback.
      }
    }
  })();
}
