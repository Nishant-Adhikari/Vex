import type { Result } from "../../../ipc/result.js";
import type {
  ChatSubmitInput,
  ChatSubmitResult,
} from "../../../schemas/chat.js";

export interface ChatBridge {
  /**
   * Submit operator text for the active session. Mission sessions treat
   * their first submit as the initial goal before entering setup.
   */
  readonly submit: (
    input: ChatSubmitInput
  ) => Promise<Result<ChatSubmitResult>>;
}
