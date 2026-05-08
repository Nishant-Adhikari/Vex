/**
 * TanStack Query hooks over `vex.onboarding.*` IPC.
 */

import { queryOptions, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { EnvState } from "@shared/schemas/onboarding.js";
import { onboardingKeys } from "./queryKeys.js";

export function envStateOptions() {
  return queryOptions({
    queryKey: onboardingKeys.envState(),
    queryFn: () => window.vex.onboarding.getEnvState(),
    staleTime: 10_000,
  });
}

export function useEnvState(): UseQueryResult<Result<EnvState>> {
  return useQuery(envStateOptions());
}
