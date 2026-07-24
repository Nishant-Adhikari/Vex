/**
 * Signals section TanStack Query hooks (minimal wiring).
 *
 *  - `useSignalsToday` — read-only list of today's ingested TrendRadar signals.
 *  - `useGradeSignal`  — the per-row LLM-as-judge action (a mutation, since it
 *    triggers a model completion). Fully fail-soft: a failed grade surfaces its
 *    `Result.error` to the caller; the list keeps rendering ungraded.
 *
 * Grades are EPHEMERAL — the panel keeps them in local state, no persistence.
 */

import {
  useMutation,
  useQuery,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  SIGNALS_LIST_TODAY_DEFAULT_LIMIT,
  type SignalGradeInput,
  type SignalGradeResult,
  type SignalsListTodayResult,
} from "@shared/schemas/signals.js";
import { signalsKeys } from "./queryKeys.js";

const STALE_MS = 30_000;
const DEFAULT_WITHIN_HOURS = 24;

/** Today's ingested signals (highest score first). */
export function useSignalsToday(
  withinHours: number = DEFAULT_WITHIN_HOURS,
): UseQueryResult<Result<SignalsListTodayResult>> {
  return useQuery({
    queryKey: signalsKeys.today(withinHours),
    queryFn: () =>
      window.vex.signals.listToday({
        withinHours,
        limit: SIGNALS_LIST_TODAY_DEFAULT_LIMIT,
      }),
    staleTime: STALE_MS,
  });
}

/**
 * Grade one signal via the LLM-as-judge. A mutation because it drives a model
 * completion; callers use `mutateAsync` and store the returned `Result` in
 * local (ephemeral) state. No cache invalidation — grading a signal changes no
 * server state (it never mutates the DB or a wallet).
 */
export function useGradeSignal(): UseMutationResult<
  Result<SignalGradeResult>,
  Error,
  SignalGradeInput
> {
  return useMutation({
    mutationFn: (input: SignalGradeInput) => window.vex.signals.grade(input),
  });
}
