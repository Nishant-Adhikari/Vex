/**
 * Mission TanStack hooks (puzzle 04 phase 6).
 *
 * Per-command typed mutations + onSuccess invalidation:
 *
 *   - `missionKeys.draft` invalidates on every mutation that may
 *     change the mission row (acceptContract, start, continue,
 *     recover, rewind, restore, renew, stop)
 *   - `missionKeys.diff` invalidates on acceptContract / start /
 *     stop / rewind / restore / renew
 *   - `runtimeKeys.state` invalidates on start / continue / recover /
 *     stop / rewind / restore (runtime control state changes)
 *   - `messagesKeys.forSession` invalidates on rewind / restore
 *     (transcript prefix-match catch-all so tail/list/around all
 *     refetch)
 *
 * `useMissionDiff` query reader follows the same staleTime as
 * `useMissionDraft`.
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
  MissionAcceptContractInput,
  MissionAcceptContractResult,
  MissionContinueInput,
  MissionContinueResult,
  MissionGetDiffInput,
  MissionGetDiffResult,
  MissionGetDraftResult,
  MissionRecoverInput,
  MissionRecoverResult,
  MissionRenewInput,
  MissionRenewResult,
  MissionRestoreInput,
  MissionRestoreResult,
  MissionRewindInput,
  MissionRewindResult,
  MissionStartInput,
  MissionStartResult,
  MissionStopInput,
  MissionStopResult,
  MissionUpdateDraftInput,
  MissionUpdateDraftResult,
} from "@shared/schemas/mission.js";
import {
  messagesKeys,
  missionKeys,
  runtimeKeys,
} from "./queryKeys.js";

const STALE_MS = 5_000;

// ── Queries (read-only) ─────────────────────────────────────────

function draftOptions(sessionId: string) {
  return queryOptions({
    queryKey: missionKeys.draft(sessionId),
    queryFn: () => window.vex.mission.getDraft({ sessionId }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

export function useMissionDraft(
  sessionId: string | null,
): UseQueryResult<Result<MissionGetDraftResult>> {
  return useQuery(draftOptions(sessionId ?? ""));
}

function diffOptions(input: { sessionId: string; missionId: string }) {
  return queryOptions({
    queryKey: missionKeys.diff(input.sessionId, input.missionId),
    queryFn: () =>
      window.vex.mission.getDiff({
        sessionId: input.sessionId,
        missionId: input.missionId,
      }),
    staleTime: STALE_MS,
    enabled: input.sessionId.length > 0 && input.missionId.length > 0,
  });
}

export function useMissionDiff(
  sessionId: string | null,
  missionId: string | null,
): UseQueryResult<Result<MissionGetDiffResult>> {
  return useQuery(diffOptions({
    sessionId: sessionId ?? "",
    missionId: missionId ?? "",
  }));
}

// ── Mutations ───────────────────────────────────────────────────

export function useAcceptMissionContract(): UseMutationResult<
  Result<MissionAcceptContractResult>,
  Error,
  MissionAcceptContractInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.acceptContract(input),
    retry: false,
    onSuccess: (_result, input) => {
      qc.invalidateQueries({ queryKey: missionKeys.draft(input.sessionId) });
      qc.invalidateQueries({
        queryKey: missionKeys.diff(input.sessionId, input.missionId),
      });
    },
  });
}

export function useUpdateMissionDraft(): UseMutationResult<
  Result<MissionUpdateDraftResult>,
  Error,
  MissionUpdateDraftInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.updateDraft(input),
    retry: false,
    onSuccess: (_result, input) => {
      // Phase 6 leaves updateDraft fail-closed but we still invalidate
      // so when phase 7+ wires the structured form, hooks already
      // refresh the draft + diff caches without further changes.
      qc.invalidateQueries({ queryKey: missionKeys.draft(input.sessionId) });
    },
  });
}

export function useMissionGetDiff(): UseMutationResult<
  Result<MissionGetDiffResult>,
  Error,
  MissionGetDiffInput
> {
  return useMutation({
    mutationFn: (input) => window.vex.mission.getDiff(input),
    retry: false,
  });
}

export function useMissionStart(): UseMutationResult<
  Result<MissionStartResult>,
  Error,
  MissionStartInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.start(input),
    retry: false,
    onSuccess: (_result, input) => {
      qc.invalidateQueries({ queryKey: missionKeys.draft(input.sessionId) });
      qc.invalidateQueries({
        queryKey: missionKeys.diff(input.sessionId, input.missionId),
      });
      qc.invalidateQueries({ queryKey: runtimeKeys.state(input.sessionId) });
    },
  });
}

export function useMissionContinue(): UseMutationResult<
  Result<MissionContinueResult>,
  Error,
  MissionContinueInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.continue(input),
    retry: false,
    onSuccess: (_result, input) => {
      qc.invalidateQueries({ queryKey: runtimeKeys.state(input.sessionId) });
    },
  });
}

export function useMissionRecover(): UseMutationResult<
  Result<MissionRecoverResult>,
  Error,
  MissionRecoverInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.recover(input),
    retry: false,
    onSuccess: (_result, input) => {
      qc.invalidateQueries({ queryKey: missionKeys.draft(input.sessionId) });
      qc.invalidateQueries({ queryKey: runtimeKeys.state(input.sessionId) });
    },
  });
}

export function useMissionRewind(): UseMutationResult<
  Result<MissionRewindResult>,
  Error,
  MissionRewindInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.rewind(input),
    retry: false,
    onSuccess: (_result, input) => {
      // forSession catch-all matches every tail/list/around variant —
      // the prefix lookup is critical because rewind moves arbitrary
      // ranges of messages out of the live tape.
      qc.invalidateQueries({
        queryKey: messagesKeys.forSession(input.sessionId),
      });
      qc.invalidateQueries({ queryKey: runtimeKeys.state(input.sessionId) });
      qc.invalidateQueries({ queryKey: missionKeys.draft(input.sessionId) });
    },
  });
}

export function useMissionRestore(): UseMutationResult<
  Result<MissionRestoreResult>,
  Error,
  MissionRestoreInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.restore(input),
    retry: false,
    onSuccess: (_result, input) => {
      qc.invalidateQueries({
        queryKey: messagesKeys.forSession(input.sessionId),
      });
      qc.invalidateQueries({ queryKey: runtimeKeys.state(input.sessionId) });
      qc.invalidateQueries({ queryKey: missionKeys.draft(input.sessionId) });
    },
  });
}

export function useMissionRenew(): UseMutationResult<
  Result<MissionRenewResult>,
  Error,
  MissionRenewInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.renew(input),
    retry: false,
    onSuccess: (_result, input) => {
      // Renew creates a NEW draft row (different missionId). Invalidate
      // both draft (so the new row shows) and diff (so the old card
      // refreshes against the new mission id when it eventually picks
      // the new draft).
      qc.invalidateQueries({ queryKey: missionKeys.draft(input.sessionId) });
      qc.invalidateQueries({ queryKey: missionKeys.all });
    },
  });
}

export function useMissionStop(): UseMutationResult<
  Result<MissionStopResult>,
  Error,
  MissionStopInput
> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input) => window.vex.mission.stop(input),
    retry: false,
    onSuccess: (_result, input) => {
      qc.invalidateQueries({ queryKey: runtimeKeys.state(input.sessionId) });
    },
  });
}
