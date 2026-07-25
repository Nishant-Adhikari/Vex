/**
 * App-level user preferences — TanStack Query hooks over `window.vex.settings.*`.
 *
 * Fork feature: the keep-awake-during-mission toggle. The renderer reads the
 * persisted value from preferences and flips it via `setKeepAwakeDuringMission`;
 * main persists it and its keep-awake worker (which observes preferencesStore)
 * reconciles the `powerSaveBlocker` — the renderer never touches power state.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  KeepAwakeState,
  Preferences,
} from "@shared/schemas/preferences.js";
import { settingsKeys } from "./queryKeys.js";

/** Full persisted preferences read (stable — refreshed via mutations below). */
export function usePreferences(): UseQueryResult<Result<Preferences>> {
  return useQuery({
    queryKey: settingsKeys.preferences(),
    queryFn: () => window.vex.settings.getPreferences(),
    staleTime: Number.POSITIVE_INFINITY,
    retry: 0,
  });
}

/**
 * Live keep-awake worker state (fork feature) — whether the macOS clamshell
 * (lid-close) override is actually holding the Mac awake vs. idle-only /
 * admin-declined. Polled while mounted so the mission-controls indicator tracks
 * the real main-process state (an admin-prompt decline flips it to idle-only).
 * `enabled` lets the caller poll only while the toggle is on + a run is active.
 */
export function useKeepAwakeState(
  enabled = true,
): UseQueryResult<Result<KeepAwakeState>> {
  return useQuery({
    queryKey: settingsKeys.keepAwakeState(),
    queryFn: () => window.vex.settings.getKeepAwakeState(),
    enabled,
    refetchInterval: enabled ? 4_000 : false,
    staleTime: 0,
    retry: 0,
  });
}

/**
 * Persist the mission-scoped keep-awake toggle. On success we write the fresh
 * preferences straight into the cache so the toggle reflects the persisted
 * truth without a refetch round-trip.
 */
export function useSetKeepAwakeDuringMission(): UseMutationResult<
  Result<Preferences>,
  Error,
  boolean
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) =>
      window.vex.settings.setKeepAwakeDuringMission({ enabled }),
    retry: false,
    onSuccess: (result) => {
      if (result.ok) {
        queryClient.setQueryData<Result<Preferences>>(
          settingsKeys.preferences(),
          result,
        );
      }
    },
  });
}
