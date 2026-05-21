import { CH } from "../../shared/ipc/channels.js";
import type { CapabilitiesBridge } from "../../shared/types/bridge/shell/capabilities.js";
import { invokeWithSchema } from "../_dispatch.js";

export const capabilities = {
  get() {
    return invokeWithSchema(CH.capabilities.get, {});
  },
} satisfies CapabilitiesBridge;
