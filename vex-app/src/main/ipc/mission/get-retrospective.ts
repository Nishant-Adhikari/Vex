/**
 * `mission.getRetrospective` — read-or-lazily-generate the "lessons learned"
 * retrospective for a session's latest finalized mission run (the completed-
 * mission card's Retrospective section).
 *
 * Cached in `mission_retrospectives` (migration 044). Generation is a single
 * one-shot OpenRouter completion (the Signals-grade inference path — NOT the
 * mission turn-loop), reviewing the run's outcome, PnL, stop reason, and the
 * executed trades WITH their agent-authored rationales.
 *
 * FAIL-SOFT: no finalized run, inference unavailable, or a malformed reply all
 * resolve to `null` (a successful Result carrying null), so the card renders
 * without the section rather than erroring.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionGetRetrospectiveInputSchema,
  missionGetRetrospectiveResultSchema,
  type MissionGetRetrospectiveResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";

export function registerMissionGetRetrospectiveHandler(): () => void {
  return registerHandler({
    channel: CH.mission.getRetrospective,
    domain: "mission",
    inputSchema: missionGetRetrospectiveInputSchema,
    outputSchema: missionGetRetrospectiveResultSchema,
    handle: async (input, ctx): Promise<Result<MissionGetRetrospectiveResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { getOrGenerateRetrospective } = await import(
          "../../mission/retrospective.js"
        );
        const dto = await getOrGenerateRetrospective(
          input.sessionId,
          ctx.requestId,
        );
        log.info(
          `[ipc:vex:mission:getRetrospective] ok found=${dto !== null} correlationId=${ctx.requestId}`,
        );
        return ok(dto);
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:getRetrospective] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
