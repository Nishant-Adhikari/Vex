/**
 * `mission.updateDraft` — fail-closed in phase 6.
 *
 * Reasoning (codex Q5): no UI calls this yet — the structured setup
 * form lands in phase 7+. The model-driven `mission_draft_update`
 * tool path is unaffected, and the phase-4 `commitMissionStart`
 * atomic gate rejects starts with `stale_acceptance` if the draft
 * drifts after acceptance.
 *
 * The handler keeps a per-command discriminated-union result so the
 * preload bridge + renderer hook surface compile against the eventual
 * shape; the result is a single `unavailable` literal for now.
 */

import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  missionUpdateDraftInputSchema,
  missionUpdateDraftResultSchema,
  type MissionUpdateDraftResult,
} from "@shared/schemas/mission.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerMissionUpdateDraftHandler(): () => void {
  return registerHandler({
    channel: CH.mission.updateDraft,
    domain: "mission",
    inputSchema: missionUpdateDraftInputSchema,
    outputSchema: missionUpdateDraftResultSchema,
    handle: async (_input, ctx): Promise<Result<MissionUpdateDraftResult>> => {
      log.info(
        `[ipc:vex:mission:updateDraft] unavailable ` +
          `correlationId=${ctx.requestId} ` +
          `(phase 7 lands the structured setup form)`,
      );
      return ok({ outcome: "unavailable" });
    },
  });
}
