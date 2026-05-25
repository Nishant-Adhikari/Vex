/**
 * Polymarket configured-addresses hook (puzzle 5 B-UI).
 *
 * Surfaces the lowercased EVM addresses that currently have Polymarket CLOB
 * credentials in the vault so the wallet picker in
 * `PolymarketAutoSetupSection` can render a per-wallet ✓ configured / ◦ not
 * badge. PUBLIC ADDRESSES ONLY — credential material never crosses the IPC
 * boundary.
 *
 * Mirrors `wallet-inventory.ts`: a neutral read hook over the onboarding IPC
 * surface (`window.vex.onboarding.polymarketConfiguredAddresses`), ~10s
 * staleTime, invalidated after a successful auto-setup write.
 */

import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { PolymarketConfiguredAddressesResult } from "@shared/schemas/api-keys.js";
import { onboardingKeys } from "./queryKeys.js";

const STALE_MS = 10_000;

export function configuredPolymarketAddressesOptions() {
  return queryOptions({
    queryKey: onboardingKeys.polymarketConfiguredAddresses(),
    queryFn: () => window.vex.onboarding.polymarketConfiguredAddresses(),
    staleTime: STALE_MS,
  });
}

/** EVM addresses with Polymarket CLOB credentials already configured. */
export function useConfiguredPolymarketAddresses(): UseQueryResult<
  Result<PolymarketConfiguredAddressesResult>
> {
  return useQuery(configuredPolymarketAddressesOptions());
}
