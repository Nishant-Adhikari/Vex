/**
 * Sessions TanStack Query hooks (M12 multi-session shell).
 *
 * `useSessionsList` is the sidebar's primary read; its query key matches
 * `sessionKeys.list()` so a successful `useCreateSession` invalidates the
 * sidebar atomically. `useSession(id)` is the per-session detail read,
 * keyed independently so opening a session in the panel doesn't refetch
 * the whole list.
 *
 * Mutation `onSuccess` invalidates the list AND seeds the detail cache
 * with the freshly-created row — the panel can render mission-mode
 * metadata immediately without an extra IPC roundtrip.
 */

import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  SessionCreateInput,
  SessionCreateResult,
  SessionList,
  SessionListItem,
  SessionSetPinnedInput,
  SessionSetPinnedResult,
} from "@shared/schemas/sessions.js";

export const sessionKeys = {
  all: ["sessions"] as const,
  list: () => ["sessions", "list"] as const,
  detail: (id: string) => ["sessions", "detail", id] as const,
};

function sessionsListOptions() {
  return queryOptions({
    queryKey: sessionKeys.list(),
    queryFn: () => window.vex.sessions.list(),
    staleTime: 5_000,
  });
}

function sessionDetailOptions(id: string) {
  return queryOptions({
    queryKey: sessionKeys.detail(id),
    queryFn: () => window.vex.sessions.get({ id }),
    staleTime: 5_000,
    enabled: id.length > 0,
  });
}

export function useSessionsList(): UseQueryResult<Result<SessionList>> {
  return useQuery(sessionsListOptions());
}

export function useSession(
  id: string | null,
): UseQueryResult<Result<SessionListItem | null>> {
  // `enabled: false` when id is null keeps the hook order stable while
  // still letting us early-skip the IPC when nothing is selected.
  return useQuery({
    ...sessionDetailOptions(id ?? ""),
    enabled: id !== null && id.length > 0,
  });
}

export function useCreateSession(): UseMutationResult<
  Result<SessionCreateResult>,
  Error,
  SessionCreateInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SessionCreateInput) =>
      window.vex.sessions.create(input),
    onSuccess: (result) => {
      if (!result.ok) return;
      // Seed detail cache with the canonical row — panel opens
      // without a round-trip.
      queryClient.setQueryData(
        sessionKeys.detail(result.data.id),
        { ok: true, data: result.data } satisfies Result<SessionListItem>,
      );
      // List query gets invalidated so the sidebar re-fetches in order
      // (pinned-first then started_at DESC).
      void queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}

/**
 * Pin/unpin a session. The DB helper returns a canonical `SessionListItem`
 * with `missionStatus` already enriched, so seeding the detail cache is
 * safe — no risk of wiping an active mission status with `null`.
 *
 * List invalidation fires every time so the sidebar re-sorts (pinned
 * rows surface in the new Pinned bucket and disappear from time buckets).
 */
export function useSetSessionPinned(): UseMutationResult<
  Result<SessionSetPinnedResult>,
  Error,
  SessionSetPinnedInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SessionSetPinnedInput) =>
      window.vex.sessions.setPinned(input),
    onSuccess: (result) => {
      if (!result.ok) return;
      if (result.data !== null) {
        queryClient.setQueryData(
          sessionKeys.detail(result.data.id),
          { ok: true, data: result.data } satisfies Result<SessionListItem>,
        );
      }
      void queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
    },
  });
}
