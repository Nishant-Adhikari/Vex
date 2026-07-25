/**
 * `mission.getStrategy` — the audit view's primary read: the currently-active
 * adaptive strategy, the pending-approval queue, and the loop posture (enabled /
 * auto-approve). Read-only; fail-soft to a null active + empty pending on error.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionGetStrategyInputSchema,
  missionGetStrategyResultSchema,
  type MissionGetStrategyResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { toStrategyVersionDto } from "../../mission/strategy-dto.js";

export function registerMissionGetStrategyHandler(): () => void {
  return registerHandler({
    channel: CH.mission.getStrategy,
    domain: "mission",
    inputSchema: missionGetStrategyInputSchema,
    outputSchema: missionGetStrategyResultSchema,
    handle: async (_input, ctx): Promise<Result<MissionGetStrategyResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { getActiveVersion, listPendingVersions } = await import(
          "@vex-agent/db/repos/strategy-versions.js"
        );
        const { resolveStrategyLoopConfig } = await import(
          "../../mission/strategy-config.js"
        );
        const [active, pending] = await Promise.all([
          getActiveVersion(),
          listPendingVersions(20),
        ]);
        const config = resolveStrategyLoopConfig();
        return ok({
          active: active ? toStrategyVersionDto(active) : null,
          pending: pending.map(toStrategyVersionDto),
          enabled: config.enabled,
          autoApprove: config.autoApprove,
        });
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:getStrategy] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
