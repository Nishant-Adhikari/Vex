/**
 * Session wallet scope TanStack Query/Mutation hooks (puzzle 1).
 *
 * Distinct from the existing `wallets.ts` api module which targets
 * onboarding wallet operations. This file owns the per-session wallet
 * scope contract that puzzle 05/10 fills in.
 *
 * `useSessionWallets` returns an empty scope today. The mutation hooks
 * (`useSetSessionWalletScope`, `useGetPreparedIntent` is read-style
 * but DB-backed in future; `useCancelPreparedIntent`) all fail-closed
 * until the wallet scope rows + intent runtime ship.
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
  PreparedIntentDto,
  SessionWalletScopeDto,
  WalletsActionResult,
  WalletsCancelPreparedIntentInput,
  WalletsSetScopeInput,
  WalletsSetScopeResult,
} from "@shared/schemas/wallets.js";
import { walletsKeys } from "./queryKeys.js";

const STALE_MS = 10_000;

function sessionScopeOptions(sessionId: string) {
  return queryOptions({
    queryKey: walletsKeys.sessionScope(sessionId),
    queryFn: () => window.vex.wallets.listSessionWallets({ sessionId }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

function preparedIntentOptions(intentId: string) {
  return queryOptions({
    queryKey: walletsKeys.preparedIntent(intentId),
    queryFn: () => window.vex.wallets.getPreparedIntent({ intentId }),
    staleTime: STALE_MS,
    enabled: intentId.length > 0,
  });
}

export function useSessionWallets(
  sessionId: string | null,
): UseQueryResult<Result<SessionWalletScopeDto>> {
  return useQuery(sessionScopeOptions(sessionId ?? ""));
}

export function usePreparedIntent(
  intentId: string | null,
): UseQueryResult<Result<PreparedIntentDto | null>> {
  return useQuery(preparedIntentOptions(intentId ?? ""));
}

export function useSetSessionWalletScope(): UseMutationResult<
  Result<WalletsSetScopeResult>,
  Error,
  WalletsSetScopeInput
> {
  return useMutation({
    mutationFn: (input) => window.vex.wallets.setSessionWalletScope(input),
    retry: false,
  });
}

export function useCancelPreparedIntent(): UseMutationResult<
  Result<WalletsActionResult>,
  Error,
  WalletsCancelPreparedIntentInput
> {
  return useMutation({
    mutationFn: (input) => window.vex.wallets.cancelPreparedIntent(input),
    retry: false,
  });
}
