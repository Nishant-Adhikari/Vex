/**
 * `mission.rollbackStrategyVersion` — activate a PRIOR version (a previously
 * active-then-archived version, or the baseline) so live missions revert to it.
 * Prior versions are never mutated/destroyed, so rollback is always available.
 * A 'rejected' row can never be activated (guarded in the repo).
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionActivateStrategyInputSchema,
  missionActivateStrategyResultSchema,
  type MissionActivateStrategyResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { toStrategyVersionDto } from "../../mission/strategy-dto.js";

export function registerMissionRollbackStrategyVersionHandler(): () => void {
  return registerHandler({
    channel: CH.mission.rollbackStrategyVersion,
    domain: "mission",
    inputSchema: missionActivateStrategyInputSchema,
    outputSchema: missionActivateStrategyResultSchema,
    handle: async (input, ctx): Promise<Result<MissionActivateStrategyResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { activateVersion } = await import(
          "@vex-agent/db/repos/strategy-versions.js"
        );
        const active = await activateVersion(input.id);
        if (active === null) {
          log.warn(
            `[ipc:vex:mission:rollbackStrategyVersion] cannot activate id=${input.id} (missing/rejected) correlationId=${ctx.requestId}`,
          );
          return err(controlFailedError(ctx.requestId));
        }
        log.info(
          `[ipc:vex:mission:rollbackStrategyVersion] rolled back to id=${input.id} v${active.versionNo} correlationId=${ctx.requestId}`,
        );
        return ok({ active: toStrategyVersionDto(active) });
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:rollbackStrategyVersion] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
