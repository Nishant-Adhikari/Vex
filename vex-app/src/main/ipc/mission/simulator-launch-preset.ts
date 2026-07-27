import { CH } from "@shared/ipc/channels.js";
import { err, ok, type Result } from "@shared/ipc/result.js";
import {
  simulatorLaunchPresetInputSchema,
  simulatorLaunchPresetResultSchema,
  type SimulatorLaunchPresetResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";
import { controlFailedError } from "../runtime/_errors.js";
import { ensureEngineDbUrl } from "../runtime/_ensure-engine-db-url.js";

export function registerMissionSimulatorLaunchPresetHandler(): () => void {
  return registerHandler({
    channel: CH.mission.simulatorLaunchPreset,
    domain: "mission",
    inputSchema: simulatorLaunchPresetInputSchema,
    outputSchema: simulatorLaunchPresetResultSchema,
    handle: async (input, ctx): Promise<Result<SimulatorLaunchPresetResult>> => {
      const dbUrlOutcome = await ensureEngineDbUrl(ctx.requestId);
      if (!dbUrlOutcome.ok) return dbUrlOutcome;
      try {
        const { launchScheduledSimulatorMission } = await import(
          "@vex-agent/engine/index.js"
        );
        return ok(await launchScheduledSimulatorMission({ seed: input.seed }));
      } catch (cause) {
        log.warn(
          `[ipc:vex:mission:simulatorLaunchPreset] failed mode=paper correlationId=${ctx.requestId}`,
          cause,
        );
        return err(controlFailedError(ctx.requestId));
      }
    },
  });
}
