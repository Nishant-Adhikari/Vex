import { CH } from "../../shared/ipc/channels.js";
import { runtimeRequestInputSchema } from "../../shared/schemas/runtime.js";
import type { RuntimeRequestInput } from "../../shared/schemas/runtime.js";
import type { RuntimeBridge } from "../../shared/types/bridge/agent/runtime.js";
import { invokeWithSchema } from "../_dispatch.js";

export const runtime = {
  getState(input: RuntimeRequestInput) {
    return invokeWithSchema(
      CH.runtime.getState,
      input,
      runtimeRequestInputSchema
    );
  },
  requestPause(input: RuntimeRequestInput) {
    return invokeWithSchema(
      CH.runtime.requestPause,
      input,
      runtimeRequestInputSchema
    );
  },
  requestStop(input: RuntimeRequestInput) {
    return invokeWithSchema(
      CH.runtime.requestStop,
      input,
      runtimeRequestInputSchema
    );
  },
  requestResume(input: RuntimeRequestInput) {
    return invokeWithSchema(
      CH.runtime.requestResume,
      input,
      runtimeRequestInputSchema
    );
  },
  cancelWake(input: RuntimeRequestInput) {
    return invokeWithSchema(
      CH.runtime.cancelWake,
      input,
      runtimeRequestInputSchema
    );
  },
} satisfies RuntimeBridge;
