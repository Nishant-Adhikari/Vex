/**
 * `mission.listStrategyVersions` — the full audit trail: every version
 * (baseline / pending / active / archived / rejected) newest-first, each row
 * carrying the driving mission run, the driving lessons, and the audit diff.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionListStrategyVersionsInputSchema,
  missionListStrategyVersionsResultSchema,
  type MissionListStrategyVersionsResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { toStrategyVersionDto } from "../../mission/strategy-dto.js";

export function registerMissionListStrategyVersionsHandler(): () => void {
  return registerHandler({
    channel: CH.mission.listStrategyVersions,
    domain: "mission",
    inputSchema: missionListStrategyVersionsInputSchema,
    outputSchema: missionListStrategyVersionsResultSchema,
    handle: async (input, ctx): Promise<Result<MissionListStrategyVersionsResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { listVersions } = await import(
          "@vex-agent/db/repos/strategy-versions.js"
        );
        const rows = await listVersions(input.limit ?? 50);
        return ok({ versions: rows.map(toStrategyVersionDto) });
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:listStrategyVersions] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
