/**
 * Mission IPC handlers — `getDraft` is read-only; every other command
 * (`updateDraft`, `getDiff`, `acceptContract`, `start`, `continue`,
 * `recover`, `rewind`, `restore`, `renew`, `stop`) fail-closes with
 * `mission.feature_unavailable` until puzzle 04 lands host-only
 * acceptance + the command runtime.
 *
 * Per Codex review: `getDiff` is fail-closed, NOT `ok({available:false})`,
 * so the renderer surfaces a placeholder card with a clear "lands in
 * puzzle 04" message rather than silently rendering an empty diff.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, type Result } from "@shared/ipc/result.js";
import {
  missionCommandInputSchema,
  missionCommandResultSchema,
  missionGetDraftInputSchema,
  missionGetDraftResultSchema,
  type MissionCommandResult,
  type MissionGetDraftResult,
} from "@shared/schemas/mission.js";
import { getDraftForSession } from "../database/missions-db.js";
import { log } from "../logger/index.js";
import { featureUnavailable } from "./_feature-unavailable.js";
import { registerHandler } from "./register-handler.js";

function registerGetDraftHandler(): () => void {
  return registerHandler({
    channel: CH.mission.getDraft,
    domain: "mission",
    inputSchema: missionGetDraftInputSchema,
    outputSchema: missionGetDraftResultSchema,
    handle: async (input, ctx): Promise<Result<MissionGetDraftResult>> => {
      const outcome = await getDraftForSession(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:mission:getDraft] ok sessionId=${input.sessionId} ` +
            `present=${outcome.data !== null} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:mission:getDraft] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerCommandHandler(channel: string, message: string): () => void {
  return registerHandler({
    channel,
    domain: "mission",
    inputSchema: missionCommandInputSchema,
    outputSchema: missionCommandResultSchema,
    handle: async (_input, ctx): Promise<Result<MissionCommandResult>> => {
      log.info(
        `[ipc:${channel}] fail-closed feature_unavailable ` +
          `correlationId=${ctx.requestId}`,
      );
      return err(
        featureUnavailable({
          domain: "mission",
          correlationId: ctx.requestId,
          message,
        }),
      );
    },
  });
}

export function registerMissionHandlers(): ReadonlyArray<() => void> {
  return [
    registerGetDraftHandler(),
    registerCommandHandler(
      CH.mission.updateDraft,
      "Mission draft editing lands in puzzle 04 (host-only acceptance + diff).",
    ),
    registerCommandHandler(
      CH.mission.getDiff,
      "Mission contract diff lands in puzzle 04 (accepted-hash comparison).",
    ),
    registerCommandHandler(
      CH.mission.acceptContract,
      "Mission contract acceptance lands in puzzle 04 (host-only).",
    ),
    registerCommandHandler(
      CH.mission.start,
      "Mission start lands in puzzle 04 (requires accepted contract hash).",
    ),
    registerCommandHandler(
      CH.mission.continue,
      "Mission continue lands in puzzle 04 (DB-backed run continuation).",
    ),
    registerCommandHandler(
      CH.mission.recover,
      "Mission recover lands in puzzle 04 (paused_error recovery).",
    ),
    registerCommandHandler(
      CH.mission.rewind,
      "/rewind lands in puzzle 04 (archive cutoff + UI confirmation).",
    ),
    registerCommandHandler(
      CH.mission.restore,
      "/restore lands in puzzle 04 (checkpoint replay).",
    ),
    registerCommandHandler(
      CH.mission.renew,
      "/mission-renew lands in puzzle 04 (new draft from last contract).",
    ),
    registerCommandHandler(
      CH.mission.stop,
      "Mission stop lands in puzzle 04 (terminal stop + audit).",
    ),
  ];
}
