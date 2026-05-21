import { CH } from "../../shared/ipc/channels.js";
import { chatSubmitInputSchema } from "../../shared/schemas/chat.js";
import type { ChatSubmitInput } from "../../shared/schemas/chat.js";
import type { ChatBridge } from "../../shared/types/bridge/agent/chat.js";
import { invokeWithSchema } from "../_dispatch.js";

export const chat = {
  submit(input: ChatSubmitInput) {
    return invokeWithSchema(CH.chat.submit, input, chatSubmitInputSchema);
  },
} satisfies ChatBridge;
