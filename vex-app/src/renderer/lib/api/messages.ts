/**
 * Messages TanStack Query hooks (agent integration puzzle 1) + live
 * transcript sync hook (puzzle 02).
 *
 * The transcript reads are read-only: renderer pulls paginated pages
 * through `window.vex.messages.*`. Puzzle 02 adds the event spine —
 * `useTranscriptLiveSync` subscribes to `EV.engine.transcriptAppend`,
 * invalidates the session's TanStack query prefix on a matching event,
 * and runs a 30s fallback poll so a missed event still surfaces.
 */

import { useEffect } from "react";
import {
  queryOptions,
  useQuery,
  useQueryClient,
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

/**
 * 30s fallback invalidation cadence used when the in-process bus event
 * is missed (engine writer outside main, dropped IPC payload, etc.).
 * Exported for tests.
 */
export const TRANSCRIPT_LIVE_FALLBACK_POLL_MS = 30_000;

/**
 * Subscribe the active session to the engine transcript event spine.
 *
 * Two refresh layers (codex review constraint #2):
 *  - **event-driven**: matching `EV.engine.transcriptAppend` payload
 *    invalidates `messagesKeys.forSession(sessionId)` so every active
 *    `useMessageTail` / `useMessageList` / `useMessageAround` for that
 *    session refetches at once;
 *  - **30s fallback poll**: `staleTime: 5s` only marks cache as stale;
 *    it does NOT trigger a refetch on its own. A missed event in an
 *    active, focused window could otherwise leave the UI stuck. The
 *    interval invalidation re-uses the same prefix so the cost is one
 *    `invalidateQueries` call per 30s while the session is active.
 *
 * Hook is a pure side effect — no render output. Mount once per active
 * session (puzzle 02 mounts it in `SessionPanel`).
 */
export function useTranscriptLiveSync(sessionId: string | null): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (sessionId === null || sessionId.length === 0) return;

    const off = window.vex.engine.onTranscriptAppend((event) => {
      if (event.sessionId !== sessionId) return;
      void queryClient.invalidateQueries({
        queryKey: messagesKeys.forSession(sessionId),
      });
    });

    const intervalId = window.setInterval(() => {
      void queryClient.invalidateQueries({
        queryKey: messagesKeys.forSession(sessionId),
      });
    }, TRANSCRIPT_LIVE_FALLBACK_POLL_MS);

    return () => {
      off();
      window.clearInterval(intervalId);
    };
  }, [sessionId, queryClient]);
}
