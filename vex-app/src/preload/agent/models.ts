import { CH } from "../../shared/ipc/channels.js";
import { modelsListAvailableInputSchema } from "../../shared/schemas/models.js";
import type { ModelsListAvailableInput } from "../../shared/schemas/models.js";
import type { ModelsBridge } from "../../shared/types/bridge/agent/models.js";
import { invokeWithSchema } from "../_dispatch.js";

export const models = {
  listAvailable(input: ModelsListAvailableInput = {}) {
    return invokeWithSchema(
      CH.models.listAvailable,
      input,
      modelsListAvailableInputSchema
    );
  },
} satisfies ModelsBridge;
