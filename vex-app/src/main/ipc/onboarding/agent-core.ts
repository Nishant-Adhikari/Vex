/**
 * vex.onboarding.agentCoreConfigure — Wizard Step 5 IPC handler (M9).
 *
 * Tri-state input (absent | number | null) per field; writer applies
 * effective-config validation against existing .env values + the
 * submitted overrides. Empty payloads still trigger validation —
 * codex turn 4 BLOCKING (a manually-corrupted .env must be detected
 * even when the user clicks Continue without changes).
 *
 * Wraps in `withEnvWriteLock` so the read-modify-write merge cannot
 * race with concurrent api-keys / embedding / keystore writes.
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  agentCoreConfigureInputSchema,
  agentCoreConfigureResultSchema,
  type AgentCoreConfigureResult,
} from "@shared/schemas/agent-core.js";
import { writeAgentCoreConfig } from "../../onboarding/agent-core-writer.js";
import { withEnvWriteLock } from "../../onboarding/env-write-mutex.js";
import { log } from "../../logger/index.js";
import { registerHandler } from "../register-handler.js";

export function registerAgentCoreHandler(): () => void {
  return registerHandler({
    channel: CH.onboarding.agentCoreConfigure,
    domain: "onboarding",
    inputSchema: agentCoreConfigureInputSchema,
    outputSchema: agentCoreConfigureResultSchema,
    handle: async (input, ctx): Promise<Result<AgentCoreConfigureResult>> => {
      const outcome = await withEnvWriteLock(() => writeAgentCoreConfig(input));
      if (outcome.ok) {
        log.info(
          `[ipc:vex:onboarding:agentCoreConfigure] ` +
            `written=${outcome.data.fieldsWritten.join(",") || "<none>"} ` +
            `cleared=${outcome.data.fieldsCleared.join(",") || "<none>"} ` +
            `correlationId=${ctx.requestId}`,
        );
      }
      return outcome;
    },
  });
}
