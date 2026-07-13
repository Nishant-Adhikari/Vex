/**
 * Transcript TanStack Query hooks (agent integration puzzle 02 + stage
 * 8-1/8-2b).
 *
 * The transcript is read-only and paginated. `useTranscriptInfinite` pages
 * backward through `window.vex.messages.list`: page 0 is the newest tail
 * (`cursor: null`), each subsequent page is older (`cursor = prev.nextCursor`).
 * `useTranscriptLiveSync` invalidates the session's query prefix on
 * `EV.engine.transcriptAppend` (+ a 30s fallback poll) so the infinite query
 * refetches; DB stays the source of truth.
 */

import { useEffect } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  MESSAGES_TAIL_MAX_LIMIT,
  type MessageCursor,
  type MessagePage,
  type SessionMessageDto,
} from "@shared/schemas/messages.js";
import { messagesKeys } from "./queryKeys.js";

const DEFAULT_LIMIT = 50;
const STALE_MS = 5_000;

/**
 * Max accumulated pages while load-older has no virtualization (stage 8-2b).
 * Bounds the chat DOM per the Vex performance rule (chats are bounded or
 * virtualized); stage 8-2c (virtualization) lifts this.
 */
export const MAX_TRANSCRIPT_PAGES = 10;

/**
 * Next cursor for the infinite transcript query. `undefined` stops paging —
 * when the last page failed, has no older history, or the page cap is hit.
 */
export function getTranscriptNextPageParam(
  lastPage: Result<MessagePage>,
  pageCount: number,
): MessageCursor | undefined {
  if (pageCount >= MAX_TRANSCRIPT_PAGES) return undefined;
  if (!lastPage.ok) return undefined;
  return lastPage.data.hasMore && lastPage.data.nextCursor !== null
    ? lastPage.data.nextCursor
    : undefined;
}

/**
 * Flatten infinite-query pages (page 0 = newest) into one chronological
 * oldest→newest list, de-duplicated by message id. Dedupe guards the rare
 * cross-page overlap a live refetch can introduce; `ok:false` pages contribute
 * nothing (the component surfaces the error separately).
 */
export function flattenTranscriptPages(
  pages: readonly Result<MessagePage>[],
): SessionMessageDto[] {
  const seen = new Set<number>();
  const out: SessionMessageDto[] = [];
  for (const page of [...pages].reverse()) {
    if (!page.ok) continue;
    for (const message of page.data.items) {
      if (seen.has(message.id)) continue;
      seen.add(message.id);
      out.push(message);
    }
  }
  return out;
}

export function useTranscriptInfinite(
  sessionId: string | null,
  limit: number = DEFAULT_LIMIT,
): UseInfiniteQueryResult<
  InfiniteData<Result<MessagePage>, MessageCursor | null>
> {
  const id = sessionId ?? "";
  return useInfiniteQuery({
    queryKey: messagesKeys.infinite(id, limit),
    queryFn: ({ pageParam }) =>
      window.vex.messages.list({ sessionId: id, cursor: pageParam, limit }),
    initialPageParam: null as MessageCursor | null,
    getNextPageParam: (lastPage, allPages) =>
      getTranscriptNextPageParam(lastPage, allPages.length),
    staleTime: STALE_MS,
    enabled: id.length > 0,
  });
}

/**
 * Read-only tail of a session's most-recent messages as a flat, oldest→newest
 * list — a thin, single-page wrapper over the same `messages:list` channel the
 * transcript uses (no new IPC, no live-sync, no pagination). It backs the
 * mission-result Decision Journal, which only needs the assistant reasoning
 * turns from a just-finalized (bounded) mission. `null` session → disabled.
 *
 * Bounded to the newest `MESSAGES_TAIL_MAX_LIMIT` rows: enough for a single
 * mission's reasoning, and the same one-page read the tail already does. A very
 * long mission whose earliest reasoning falls outside this window simply won't
 * anchor its earliest trades (they degrade to "no rationale"), never wrong data.
 */
export function useSessionMessagesTail(
  sessionId: string | null,
  limit: number = MESSAGES_TAIL_MAX_LIMIT,
): UseQueryResult<SessionMessageDto[]> {
  const id = sessionId ?? "";
  return useQuery({
    queryKey: [...messagesKeys.forSession(id), "tail", { limit }] as const,
    queryFn: async (): Promise<SessionMessageDto[]> => {
      const page = await window.vex.messages.list({
        sessionId: id,
        cursor: null,
        limit,
      });
      return page.ok ? page.data.items : [];
    },
    staleTime: STALE_MS,
    enabled: id.length > 0,
  });
}

/**
 * 30s fallback invalidation cadence used when the in-process bus event is
 * missed (engine writer outside main, dropped IPC payload, etc.). Exported
 * for tests.
 */
export const TRANSCRIPT_LIVE_FALLBACK_POLL_MS = 30_000;

/**
 * Subscribe the active session to the engine transcript event spine.
 *
 * Two refresh layers: event-driven invalidation of
 * `messagesKeys.forSession(sessionId)` (so the infinite query refetches), plus
 * a 30s fallback poll for missed events. Pure side effect — no render output.
 * Mount once per active session (`SessionPanel`).
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
