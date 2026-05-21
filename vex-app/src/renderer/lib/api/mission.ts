/**
 * Mission TanStack Query/Mutation hooks (agent integration puzzle 1).
 *
 * `useMissionDraft` reads the latest draft from main. Every other hook
 * is a fail-closed mutation that returns `mission.feature_unavailable`
 * until puzzle 04 ships host-only acceptance + the command runtime.
 *
 * Surface ships now so the puzzle-08 UI can wire slash commands +
 * mission contract buttons against the eventual contract without
 * having to bolt on new hooks later.
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
  MissionCommandInput,
  MissionCommandResult,
  MissionGetDraftResult,
} from "@shared/schemas/mission.js";
import { missionKeys } from "./queryKeys.js";

const STALE_MS = 5_000;

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

type MissionCommandMutation = UseMutationResult<
  Result<MissionCommandResult>,
  Error,
  MissionCommandInput
>;

function makeCommandHook(
  fn: (input: MissionCommandInput) => Promise<Result<MissionCommandResult>>,
): () => MissionCommandMutation {
  return function useCommand(): MissionCommandMutation {
    return useMutation({
      mutationFn: fn,
      retry: false,
    });
  };
}

export const useUpdateMissionDraft = makeCommandHook((input) =>
  window.vex.mission.updateDraft(input),
);
export const useMissionGetDiff = makeCommandHook((input) =>
  window.vex.mission.getDiff(input),
);
export const useAcceptMissionContract = makeCommandHook((input) =>
  window.vex.mission.acceptContract(input),
);
export const useMissionStart = makeCommandHook((input) =>
  window.vex.mission.start(input),
);
export const useMissionContinue = makeCommandHook((input) =>
  window.vex.mission.continue(input),
);
export const useMissionRecover = makeCommandHook((input) =>
  window.vex.mission.recover(input),
);
export const useMissionRewind = makeCommandHook((input) =>
  window.vex.mission.rewind(input),
);
export const useMissionRestore = makeCommandHook((input) =>
  window.vex.mission.restore(input),
);
export const useMissionRenew = makeCommandHook((input) =>
  window.vex.mission.renew(input),
);
export const useMissionStop = makeCommandHook((input) =>
  window.vex.mission.stop(input),
);
