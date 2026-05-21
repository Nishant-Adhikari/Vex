import { CH } from "../../shared/ipc/channels.js";
import {
  missionCommandInputSchema,
  missionGetDraftInputSchema,
} from "../../shared/schemas/mission.js";
import type {
  MissionCommandInput,
  MissionGetDraftInput,
} from "../../shared/schemas/mission.js";
import type { MissionBridge } from "../../shared/types/bridge/agent/mission.js";
import { invokeWithSchema } from "../_dispatch.js";

export const mission = {
  getDraft(input: MissionGetDraftInput) {
    return invokeWithSchema(
      CH.mission.getDraft,
      input,
      missionGetDraftInputSchema
    );
  },
  updateDraft(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.updateDraft,
      input,
      missionCommandInputSchema
    );
  },
  getDiff(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.getDiff,
      input,
      missionCommandInputSchema
    );
  },
  acceptContract(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.acceptContract,
      input,
      missionCommandInputSchema
    );
  },
  start(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.start,
      input,
      missionCommandInputSchema
    );
  },
  continue(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.continue,
      input,
      missionCommandInputSchema
    );
  },
  recover(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.recover,
      input,
      missionCommandInputSchema
    );
  },
  rewind(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.rewind,
      input,
      missionCommandInputSchema
    );
  },
  restore(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.restore,
      input,
      missionCommandInputSchema
    );
  },
  renew(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.renew,
      input,
      missionCommandInputSchema
    );
  },
  stop(input: MissionCommandInput) {
    return invokeWithSchema(
      CH.mission.stop,
      input,
      missionCommandInputSchema
    );
  },
} satisfies MissionBridge;
