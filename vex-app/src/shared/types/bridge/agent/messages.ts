import type { Result } from "../../../ipc/result.js";
import type {
  MessagePage,
  MessagesGetAroundInput,
  MessagesGetTailInput,
  MessagesListInput,
} from "../../../schemas/messages.js";

/**
 * Paginated transcript reads. Live messages only — archive/restore
 * arrives with puzzle 04. Mapper redacts raw `tool_calls` /
 * `metadata` JSONB; the renderer only sees allow-listed fields.
 */
export interface MessagesBridge {
  readonly list: (input: MessagesListInput) => Promise<Result<MessagePage>>;
  readonly getTail: (
    input: MessagesGetTailInput
  ) => Promise<Result<MessagePage>>;
  readonly getAround: (
    input: MessagesGetAroundInput
  ) => Promise<Result<MessagePage>>;
}
