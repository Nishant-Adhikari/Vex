/**
 * Provider API (M10 Step 6).
 *
 * Secret handling — same rule as M9 Step 3 (api-keys): the IPC
 * payload carries the OPENROUTER_API_KEY secret. Routing it through
 * `useMutation` would park the secret in observer state for
 * staleness/devtools. So `persistProvider` is a plain async function.
 * Callers MUST:
 *   - read the apiKey from an UNCONTROLLED DOM ref at submit time,
 *   - clear `apiKeyRef.current.value = ""` synchronously BEFORE the
 *     await call,
 *   - drive pending state via local useState,
 *   - call `useInvalidateEnvStateAfterProviderWrite()` on success.
 *
 * The IPC handler does verify-then-persist atomically: it sends a
 * 16-token chat completion to OpenRouter to validate the (apiKey,
 * model) pair BEFORE writing the 3 .env keys.
 */

import { useQueryClient } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  ProviderPersistInput,
  ProviderPersistResult,
} from "@shared/schemas/provider.js";
import { onboardingKeys } from "./queryKeys.js";

export async function persistProvider(
  input: ProviderPersistInput,
): Promise<Result<ProviderPersistResult>> {
  return window.vex.onboarding.providerPersist(input);
}

export function useInvalidateEnvStateAfterProviderWrite(): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({
      queryKey: onboardingKeys.envState(),
    });
  };
}
