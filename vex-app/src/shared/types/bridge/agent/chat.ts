import type { AbortableInvocation } from "../common.js";
import type {
  ChatSubmitInput,
  ChatSubmitResult,
} from "../../../schemas/chat.js";

export interface ChatBridge {
  /**
   * Submit operator text for the active session. Mission sessions treat
   * their first submit as the initial goal before entering setup.
   *
   * Abortable (9-5b): the renderer holds `cancel` to stop an in-flight
   * chat turn. Unlike most cancellable handlers, a stopped chat turn
   * resolves `promise` with `ok(... stopReason:"user_stopped" ...)`
   * carrying the persisted partial — not an `internal.cancelled` error
   * (the engine returns the partial normally on abort). See
   * `AbortableInvocation`.
   */
  readonly submit: (
    input: ChatSubmitInput
  ) => AbortableInvocation<ChatSubmitResult>;
}
