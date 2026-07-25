/**
 * `mission.approveStrategyVersion` — the human approval gate. Activates a
 * PENDING revision so it becomes the live adaptive strategy for future missions.
 * This is the default posture's one required human step (propose-then-approve).
 *
 * Refuses anything not currently 'pending' (a rejected row can never be
 * activated; use rollback for archived versions) so approval is unambiguous.
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

export function registerMissionApproveStrategyVersionHandler(): () => void {
  return registerHandler({
    channel: CH.mission.approveStrategyVersion,
    domain: "mission",
    inputSchema: missionActivateStrategyInputSchema,
    outputSchema: missionActivateStrategyResultSchema,
    handle: async (input, ctx): Promise<Result<MissionActivateStrategyResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { getVersionById, activateVersion } = await import(
          "@vex-agent/db/repos/strategy-versions.js"
        );
        const target = await getVersionById(input.id);
        if (target === null || target.status !== "pending") {
          log.warn(
            `[ipc:vex:mission:approveStrategyVersion] not pending id=${input.id} status=${target?.status ?? "missing"} correlationId=${ctx.requestId}`,
          );
          return err(controlFailedError(ctx.requestId));
        }
        const active = await activateVersion(input.id);
        log.info(
          `[ipc:vex:mission:approveStrategyVersion] approved id=${input.id} correlationId=${ctx.requestId}`,
        );
        return ok({ active: active ? toStrategyVersionDto(active) : null });
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:approveStrategyVersion] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
