/**
 * Usage IPC handlers — read-only last-turn + session totals.
 *
 * Read-only handlers backed by `usage-db.ts`. Empty sessions resolve
 * to all-zero totals + `null` last turn — never an error shape.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  lastTurnUsageResultSchema,
  sessionUsageTotalsDtoSchema,
  usageInputSchema,
  type LastTurnUsageResult,
  type SessionUsageTotalsDto,
} from "@shared/schemas/usage.js";
import { getLastTurn, getSessionTotals } from "../database/usage-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function registerGetSessionTotalsHandler(): () => void {
  return registerHandler({
    channel: CH.usage.getSessionTotals,
    domain: "usage",
    inputSchema: usageInputSchema,
    outputSchema: sessionUsageTotalsDtoSchema,
    handle: async (input, ctx): Promise<Result<SessionUsageTotalsDto>> => {
      const outcome = await getSessionTotals(input.sessionId, input.currency);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:usage:getSessionTotals] ok sessionId=${input.sessionId} ` +
            `requests=${outcome.data.requestCount} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:usage:getSessionTotals] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGetLastTurnHandler(): () => void {
  return registerHandler({
    channel: CH.usage.getLastTurn,
    domain: "usage",
    inputSchema: usageInputSchema,
    outputSchema: lastTurnUsageResultSchema,
    handle: async (input, ctx): Promise<Result<LastTurnUsageResult>> => {
      const outcome = await getLastTurn(input.sessionId, input.currency);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:usage:getLastTurn] ok sessionId=${input.sessionId} ` +
            `present=${outcome.data !== null} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:usage:getLastTurn] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

export function registerUsageHandlers(): ReadonlyArray<() => void> {
  return [
    registerGetSessionTotalsHandler(),
    registerGetLastTurnHandler(),
  ];
}
