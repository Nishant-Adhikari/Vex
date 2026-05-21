/**
 * Approvals TanStack Query/Mutation hooks (agent integration puzzle 1).
 *
 * `usePendingApprovals`, `useApproval`, `useApprovalHistory` are
 * read-only — the DTOs are allow-listed (no raw `tool_call` JSONB).
 *
 * `useApprove`/`useReject` fail-closed with
 * `approvals.feature_unavailable` until puzzle 05 lands durable
 * approval intents + idempotent runtime continuation.
 */

import {
  queryOptions,
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  APPROVAL_HISTORY_DEFAULT_LIMIT,
  type ApprovalActionInput,
  type ApprovalActionResult,
  type ApprovalSummaryDto,
} from "@shared/schemas/approvals.js";
import { approvalsKeys } from "./queryKeys.js";

const STALE_MS = 3_000;

function pendingOptions(sessionId: string) {
  return queryOptions({
    queryKey: approvalsKeys.pending(sessionId),
    queryFn: () => window.vex.approvals.listPending({ sessionId }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

function detailOptions(id: string) {
  return queryOptions({
    queryKey: approvalsKeys.detail(id),
    queryFn: () => window.vex.approvals.get({ id }),
    staleTime: STALE_MS,
    enabled: id.length > 0,
  });
}

function historyOptions(sessionId: string, limit: number) {
  return queryOptions({
    queryKey: approvalsKeys.history(sessionId, limit),
    queryFn: () =>
      window.vex.approvals.getHistory({ sessionId, limit }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

export function usePendingApprovals(
  sessionId: string | null,
): UseQueryResult<Result<ReadonlyArray<ApprovalSummaryDto>>> {
  return useQuery(pendingOptions(sessionId ?? ""));
}

export function useApproval(
  id: string | null,
): UseQueryResult<Result<ApprovalSummaryDto | null>> {
  return useQuery(detailOptions(id ?? ""));
}

export function useApprovalHistory(
  sessionId: string | null,
  limit: number = APPROVAL_HISTORY_DEFAULT_LIMIT,
): UseQueryResult<Result<ReadonlyArray<ApprovalSummaryDto>>> {
  return useQuery(historyOptions(sessionId ?? "", limit));
}

type ApprovalActionMutation = UseMutationResult<
  Result<ApprovalActionResult>,
  Error,
  ApprovalActionInput
>;

export function useApprove(): ApprovalActionMutation {
  return useMutation({
    mutationFn: (input) => window.vex.approvals.approve(input),
    retry: false,
  });
}

export function useReject(): ApprovalActionMutation {
  return useMutation({
    mutationFn: (input) => window.vex.approvals.reject(input),
    retry: false,
  });
}
