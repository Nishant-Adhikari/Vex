import { useCallback, useRef } from "react";
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  ChatSubmitInput,
  ChatSubmitResult,
} from "@shared/schemas/chat.js";
import { isUsageQueryForSession } from "./queryKeys.js";
import { sessionKeys } from "./sessions.js";

/**
 * Chat submit mutation + a stable `stop()` that cancels the in-flight turn
 * (9-5b). The active invocation's `cancel` is captured per-call and cleared
 * only when THAT same invocation settles, so a newer submit started before
 * the first resolves keeps its own handle (same ownership rule as the
 * stream-preview captured-streamId guard).
 */
export type UseSubmitChatResult = UseMutationResult<
  Result<ChatSubmitResult>,
  Error,
  ChatSubmitInput
> & { readonly stop: () => void };

export function useSubmitChat(): UseSubmitChatResult {
  const queryClient = useQueryClient();
  const cancelRef = useRef<(() => void) | null>(null);

  const mutation = useMutation({
    mutationFn: (input: ChatSubmitInput) => {
      const invocation = window.vex.chat.submit(input);
      cancelRef.current = invocation.cancel;
      return invocation.promise.finally(() => {
        if (cancelRef.current === invocation.cancel) cancelRef.current = null;
      });
    },
    onSuccess: (result, variables) => {
      if (!result.ok) return;
      void queryClient.invalidateQueries({ queryKey: sessionKeys.list() });
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.detail(variables.sessionId),
      });
      // A completed turn advances usage rows + the session token_count, so
      // refresh the runtime bar immediately (usage totals, last-turn, and
      // context window). The transcript-append live-sync is the backstop
      // for non-interactive turns (mission/wake).
      void queryClient.invalidateQueries({
        predicate: (query) =>
          isUsageQueryForSession(query.queryKey, variables.sessionId),
      });
    },
  });

  const stop = useCallback(() => {
    cancelRef.current?.();
  }, []);

  return { ...mutation, stop };
}
