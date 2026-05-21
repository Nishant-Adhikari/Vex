import { CH } from "../../shared/ipc/channels.js";
import {
  messagesGetAroundInputSchema,
  messagesGetTailInputSchema,
  messagesListInputSchema,
} from "../../shared/schemas/messages.js";
import type {
  MessagesGetAroundInput,
  MessagesGetTailInput,
  MessagesListInput,
} from "../../shared/schemas/messages.js";
import type { MessagesBridge } from "../../shared/types/bridge/agent/messages.js";
import { invokeWithSchema } from "../_dispatch.js";

export const messages = {
  list(input: MessagesListInput) {
    return invokeWithSchema(CH.messages.list, input, messagesListInputSchema);
  },
  getTail(input: MessagesGetTailInput) {
    return invokeWithSchema(
      CH.messages.getTail,
      input,
      messagesGetTailInputSchema
    );
  },
  getAround(input: MessagesGetAroundInput) {
    return invokeWithSchema(
      CH.messages.getAround,
      input,
      messagesGetAroundInputSchema
    );
  },
} satisfies MessagesBridge;
