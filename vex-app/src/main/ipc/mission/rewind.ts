/**
 * `mission.rewind` — engine archive-suffix + checkpoint stamp.
 *
 * Catches the `BLOCKED active run` throw from `rewindSession` (the
 * only path that throws) and maps it to the `blocked_active_run`
 * outcome.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionRewindInputSchema,
  missionRewindResultSchema,
  type MissionRewindResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { emitControlStateAfterChange } from "../runtime/_emit-control-state.js";

function isCannotRewindError(value: unknown): value is Error {
  return value instanceof Error && /Cannot rewind/i.test(value.message);
}

export function registerMissionRewindHandler(): () => void {
  return registerHandler({
    channel: CH.mission.rewind,
    domain: "mission",
    inputSchema: missionRewindInputSchema,
    outputSchema: missionRewindResultSchema,
    handle: async (input, ctx): Promise<Result<MissionRewindResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { rewindSession } = await import(
          "@vex-agent/engine/core/rewind.js"
        );
        const outcome = await rewindSession(input.sessionId, input.turns);
        log.info(
          `[ipc:vex:mission:rewind] noop=${outcome.noop} ` +
            `archived=${outcome.archivedMessages} ` +
            `runImpact=${outcome.missionRunImpact} ` +
            `correlationId=${ctx.requestId}`,
        );
        await emitControlStateAfterChange(input.sessionId, ctx.requestId);
        if (outcome.noop) {
          return ok({ outcome: "noop" });
        }
        return ok({
          outcome: "rewound",
          archivedMessages: outcome.archivedMessages,
          cutoffMessageId: outcome.cutoffMessageId,
          checkpointId: outcome.checkpointId,
          rejectedApprovals: outcome.rejectedApprovals,
          cancelledWakes: outcome.cancelledWakes,
          missionRunImpact: outcome.missionRunImpact,
        });
      } catch (cause) {
        if (isCannotRewindError(cause)) {
          log.info(
            `[ipc:vex:mission:rewind] blocked_active_run ` +
              `correlationId=${ctx.requestId}`,
          );
          return ok({ outcome: "blocked_active_run", reason: cause.message });
        }
        log.warn(
          `[ipc:vex:mission:rewind] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
