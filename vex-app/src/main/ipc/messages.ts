/**
 * Messages IPC handlers — read-only paginated transcript reads.
 *
 * All three handlers (`list`, `getTail`, `getAround`) flow through the
 * decoupled `messages-db.ts` helper. The renderer receives an allow-
 * listed `SessionMessageDto` page; raw `tool_calls` / `metadata` JSONB
 * never crosses the boundary.
 *
 * Read-only — no mutations here. DB unavailability maps to
 * `internal.unexpected` (per the `messages-db.ts`
 * `dbUnavailable`/`dbError` helpers).
 */

import { CH } from "@shared/ipc/channels.js";
import type { Result } from "@shared/ipc/result.js";
import {
  messagesGetAroundInputSchema,
  messagesGetTailInputSchema,
  messagesListInputSchema,
  messagePageSchema,
  type MessagePage,
} from "@shared/schemas/messages.js";
import {
  getMessageAround,
  getMessageTail,
  listMessages,
} from "../database/messages-db.js";
import { log } from "../logger/index.js";
import { registerHandler } from "./register-handler.js";

function registerListHandler(): () => void {
  return registerHandler({
    channel: CH.messages.list,
    domain: "messages",
    inputSchema: messagesListInputSchema,
    outputSchema: messagePageSchema,
    handle: async (input, ctx): Promise<Result<MessagePage>> => {
      const outcome = await listMessages(
        input.sessionId,
        input.cursor,
        input.limit,
      );
      if (outcome.ok) {
        log.info(
          `[ipc:vex:messages:list] ok sessionId=${input.sessionId} ` +
            `count=${outcome.data.items.length} hasMore=${outcome.data.hasMore} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:messages:list] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGetTailHandler(): () => void {
  return registerHandler({
    channel: CH.messages.getTail,
    domain: "messages",
    inputSchema: messagesGetTailInputSchema,
    outputSchema: messagePageSchema,
    handle: async (input, ctx): Promise<Result<MessagePage>> => {
      const outcome = await getMessageTail(input.sessionId, input.limit);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:messages:getTail] ok sessionId=${input.sessionId} ` +
            `count=${outcome.data.items.length} hasMore=${outcome.data.hasMore} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:messages:getTail] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGetAroundHandler(): () => void {
  return registerHandler({
    channel: CH.messages.getAround,
    domain: "messages",
    inputSchema: messagesGetAroundInputSchema,
    outputSchema: messagePageSchema,
    handle: async (input, ctx): Promise<Result<MessagePage>> => {
      const outcome = await getMessageAround(
        input.sessionId,
        input.messageId,
        input.before,
        input.after,
      );
      if (outcome.ok) {
        log.info(
          `[ipc:vex:messages:getAround] ok sessionId=${input.sessionId} ` +
            `messageId=${input.messageId} count=${outcome.data.items.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:messages:getAround] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

export function registerMessagesHandlers(): ReadonlyArray<() => void> {
  return [
    registerListHandler(),
    registerGetTailHandler(),
    registerGetAroundHandler(),
  ];
}
