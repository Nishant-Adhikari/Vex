/**
 * Wake API (M11 Step 8).
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { WakeSetInput, WakeSetResult } from "@shared/schemas/wake.js";
import { onboardingKeys } from "./queryKeys.js";

export function useWakeSet(): UseMutationResult<
  Result<WakeSetResult>,
  Error,
  WakeSetInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: WakeSetInput) => window.vex.onboarding.wakeSet(input),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: onboardingKeys.envState(),
        });
      }
    },
  });
}
