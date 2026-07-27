/**
 * Signals IPC handlers (Signals section) — two read-only channels:
 *   - `signals.listToday`  → today's ingested TrendRadar signals (sanitized).
 *   - `signals.grade`      → LLM-as-judge verdict for ONE signal id.
 *
 * Observability only: nothing here places a trade or mutates wallet state.
 * Both are fully fail-soft — a DB or inference error returns a redacted error
 * `Result` (the panel keeps listing signals ungraded), never throws.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, type Result } from "@shared/ipc/result.js";
import {
  signalGradeInputSchema,
  signalGradeResultSchema,
  signalsListTodayInputSchema,
  signalsListTodayResultSchema,
  type SignalGradeResult,
  type SignalsListTodayResult,
} from "@shared/schemas/signals.js";
import { getSignalById, listTodaySignals } from "../database/signals-db.js";
import { gradeSignal } from "../signals/grade.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function registerListTodayHandler(): () => void {
  return registerHandler({
    channel: CH.signals.listToday,
    domain: "signals",
    inputSchema: signalsListTodayInputSchema,
    outputSchema: signalsListTodayResultSchema,
    handle: async (input, ctx): Promise<Result<SignalsListTodayResult>> => {
      const outcome = await listTodaySignals(input, ctx.requestId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:signals:listToday] ok count=${outcome.data.length} ` +
            `withinHours=${input.withinHours} correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:signals:listToday] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGradeHandler(): () => void {
  return registerHandler({
    channel: CH.signals.grade,
    domain: "signals",
    inputSchema: signalGradeInputSchema,
    outputSchema: signalGradeResultSchema,
    handle: async (input, ctx): Promise<Result<SignalGradeResult>> => {
      const found = await getSignalById(input.id, ctx.requestId);
      if (!found.ok) return found;
      if (found.data === null) {
        return err({
          code: "internal.unexpected",
          domain: "signals",
          message: "Signal not found.",
          retryable: false,
          userActionable: false,
          redacted: true,
          correlationId: ctx.requestId,
        });
      }
      return gradeSignal(found.data, { correlationId: ctx.requestId });
    },
  });
}

export function registerSignalsHandlers(): ReadonlyArray<() => void> {
  return [registerListTodayHandler(), registerGradeHandler()];
}
