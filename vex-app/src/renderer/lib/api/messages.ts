/**
 * Messages TanStack Query hooks (agent integration puzzle 1).
 *
 * Read-only — the renderer pulls paginated transcript pages through
 * `window.vex.messages.*`. Mutation paths land in puzzle 02 once the
 * event spine + transcript append wrapper exist.
 */

import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  MessageCursor,
  MessagePage,
  MessagesGetAroundInput,
  MessagesGetTailInput,
  MessagesListInput,
} from "@shared/schemas/messages.js";
import { messagesKeys } from "./queryKeys.js";

const DEFAULT_LIMIT = 50;
const STALE_MS = 5_000;

function tailOptions(input: MessagesGetTailInput) {
  return queryOptions({
    queryKey: messagesKeys.tail(input.sessionId, input.limit),
    queryFn: () => window.vex.messages.getTail(input),
    staleTime: STALE_MS,
    enabled: input.sessionId.length > 0,
  });
}

function listOptions(input: MessagesListInput) {
  return queryOptions({
    queryKey: messagesKeys.list(
      input.sessionId,
      input.limit,
      input.cursor === null ? null : input.cursor.id,
    ),
    queryFn: () => window.vex.messages.list(input),
    staleTime: STALE_MS,
    enabled: input.sessionId.length > 0,
  });
}

function aroundOptions(input: MessagesGetAroundInput) {
  return queryOptions({
    queryKey: messagesKeys.around(
      input.sessionId,
      input.messageId,
      input.before,
      input.after,
    ),
    queryFn: () => window.vex.messages.getAround(input),
    staleTime: STALE_MS,
    enabled: input.sessionId.length > 0 && input.messageId > 0,
  });
}

export function useMessageTail(
  sessionId: string | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<Result<MessagePage>> {
  return useQuery(
    tailOptions({
      sessionId: sessionId ?? "",
      limit,
    }),
  );
}

export function useMessageList(
  sessionId: string | null,
  cursor: MessageCursor | null,
  limit: number = DEFAULT_LIMIT,
): UseQueryResult<Result<MessagePage>> {
  return useQuery(
    listOptions({
      sessionId: sessionId ?? "",
      cursor,
      limit,
    }),
  );
}

export function useMessageAround(
  sessionId: string | null,
  messageId: number | null,
  before: number,
  after: number,
): UseQueryResult<Result<MessagePage>> {
  return useQuery(
    aroundOptions({
      sessionId: sessionId ?? "",
      messageId: messageId ?? 0,
      before,
      after,
    }),
  );
}
