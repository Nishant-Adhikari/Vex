/**
 * `mission.resetStrategyBaseline` — the emergency reset. Re-syncs the baseline
 * row to the current source seed and activates it, so live missions immediately
 * revert to the human-authored adaptive tactics. Prior versions are preserved
 * (never destroyed) — this only changes which one is active.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, err, type Result } from "@shared/ipc/result.js";
import {
  missionResetStrategyInputSchema,
  missionResetStrategyResultSchema,
  type MissionResetStrategyResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";
import { toStrategyVersionDto } from "../../mission/strategy-dto.js";

export function registerMissionResetStrategyBaselineHandler(): () => void {
  return registerHandler({
    channel: CH.mission.resetStrategyBaseline,
    domain: "mission",
    inputSchema: missionResetStrategyInputSchema,
    outputSchema: missionResetStrategyResultSchema,
    handle: async (_input, ctx): Promise<Result<MissionResetStrategyResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { resetToBaseline } = await import(
          "@vex-agent/db/repos/strategy-versions.js"
        );
        const { ADAPTIVE_STRATEGY_BASELINE } = await import(
          "@vex-agent/engine/prompts/mission-adaptive.js"
        );
        const active = await resetToBaseline(ADAPTIVE_STRATEGY_BASELINE);
        log.info(
          `[ipc:vex:mission:resetStrategyBaseline] reset to baseline v${active.versionNo} correlationId=${ctx.requestId}`,
        );
        return ok({ active: toStrategyVersionDto(active) });
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:resetStrategyBaseline] failed correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
