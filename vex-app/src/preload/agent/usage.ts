import { CH } from "../../shared/ipc/channels.js";
import { usageInputSchema } from "../../shared/schemas/usage.js";
import type { UsageInput } from "../../shared/schemas/usage.js";
import type { UsageBridge } from "../../shared/types/bridge/agent/usage.js";
import { invokeWithSchema } from "../_dispatch.js";

export const usage = {
  getSessionTotals(input: UsageInput) {
    return invokeWithSchema(
      CH.usage.getSessionTotals,
      input,
      usageInputSchema
    );
  },
  getLastTurn(input: UsageInput) {
    return invokeWithSchema(CH.usage.getLastTurn, input, usageInputSchema);
  },
} satisfies UsageBridge;
