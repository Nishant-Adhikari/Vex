/**
 * vex.onboarding.* — wizard surface.
 *
 * M2 ships only `getEnvState()` for the System Check screen. M7-M11
 * add `keystoreSet`, `walletGenerate*`, `apiKeysSet`, etc. when the
 * wizard lands.
 */

import { z } from "zod";
import { CH } from "@shared/ipc/channels.js";
import { ok, type Result } from "@shared/ipc/result.js";
import {
  envStateSchema,
  type EnvState,
} from "@shared/schemas/onboarding.js";
import { gatherEnvState } from "../onboarding/env-state.js";
import { registerHandler } from "./register-handler.js";

const empty = z.object({}).strict();

export function registerOnboardingHandlers(): Array<() => void> {
  const handlers: Array<() => void> = [];

  handlers.push(
    registerHandler({
      channel: CH.onboarding.getEnvState,
      domain: "onboarding",
      inputSchema: empty,
      outputSchema: envStateSchema,
      handle: async (): Promise<Result<EnvState>> => ok(await gatherEnvState()),
    })
  );

  return handlers;
}
