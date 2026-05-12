/**
 * Mode API (M11 Step 7).
 *
 * Mode payloads are non-secret (mission goal carries operator intent
 * but not credentials), so we use TanStack `useMutation` for the
 * standard pending/error UX. envState invalidates on success so the
 * skip-card layer reflects the freshly-written `AGENT_MODE` /
 * `AGENT_LOOP_MODE` / `AGENT_INITIAL_PROMPT` triple immediately.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { ModeSetInput, ModeSetResult } from "@shared/schemas/mode.js";
import { onboardingKeys } from "./queryKeys.js";

export function useModeSet(): UseMutationResult<
  Result<ModeSetResult>,
  Error,
  ModeSetInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ModeSetInput) => window.vex.onboarding.modeSet(input),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: onboardingKeys.envState(),
        });
      }
    },
  });
}
