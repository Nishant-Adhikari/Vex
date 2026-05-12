/**
 * Finalize API (M11 Step 9).
 *
 * `completeSetup` carries the telemetryConsent boolean per codex v3
 * D11 (single combined IPC). Renderer disables the Finalize button on
 * submit so the main-side single-flight is defense-in-depth, not the
 * primary UX gate.
 *
 * On success we invalidate BOTH envState + wizardState — the latter
 * flips `completed: true` so WizardShell's effect-based "show
 * placeholder when completed" branch fires on the next render cycle.
 */

import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  CompleteSetupInput,
  CompleteSetupResult,
} from "@shared/schemas/finalize.js";
import { onboardingKeys } from "./queryKeys.js";

export function useCompleteSetup(): UseMutationResult<
  Result<CompleteSetupResult>,
  Error,
  CompleteSetupInput
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CompleteSetupInput) =>
      window.vex.onboarding.completeSetup(input),
    onSuccess: (result) => {
      if (result.ok) {
        void queryClient.invalidateQueries({
          queryKey: onboardingKeys.envState(),
        });
        void queryClient.invalidateQueries({
          queryKey: onboardingKeys.wizardState(),
        });
      }
    },
  });
}
