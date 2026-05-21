/**
 * Runtime TanStack Query/Mutation hooks (agent integration puzzle 1).
 *
 * `useRuntimeState` is read-only. The four mutation hooks
 * (`useRequestPause`, `useRequestStop`, `useRequestResume`,
 * `useCancelWake`) fire `runtime.feature_unavailable` until puzzle 03
 * lands the DB-backed control plane. They are exported now so the UI
 * (puzzle 08) can wire button handlers against the eventual contract.
 *
 * No optimistic updates for fail-closed mutations — the renderer
 * surfaces the disabled state from the returned `Result.error.code`.
 */

import {
  queryOptions,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  RuntimeRequestInput,
  RuntimeRequestResult,
  RuntimeStateDto,
} from "@shared/schemas/runtime.js";
import { runtimeKeys } from "./queryKeys.js";

const STALE_MS = 3_000;

function stateOptions(sessionId: string) {
  return queryOptions({
    queryKey: runtimeKeys.state(sessionId),
    queryFn: () => window.vex.runtime.getState({ sessionId }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

export function useRuntimeState(
  sessionId: string | null,
): UseQueryResult<Result<RuntimeStateDto>> {
  return useQuery(stateOptions(sessionId ?? ""));
}

type ControlMutation = UseMutationResult<
  Result<RuntimeRequestResult>,
  Error,
  RuntimeRequestInput
>;

export function useRequestPause(): ControlMutation {
  return useMutation({
    mutationFn: (input) => window.vex.runtime.requestPause(input),
    // Fail-closed today (`runtime.feature_unavailable`); no cache
    // invalidation — state didn't actually change.
    retry: false,
  });
}

export function useRequestStop(): ControlMutation {
  return useMutation({
    mutationFn: (input) => window.vex.runtime.requestStop(input),
    retry: false,
  });
}

export function useRequestResume(): ControlMutation {
  return useMutation({
    mutationFn: (input) => window.vex.runtime.requestResume(input),
    retry: false,
  });
}

export function useCancelWake(): ControlMutation {
  return useMutation({
    mutationFn: (input) => window.vex.runtime.cancelWake(input),
    retry: false,
  });
}
