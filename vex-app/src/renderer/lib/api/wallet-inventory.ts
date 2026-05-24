/**
 * Global wallet inventory hook — the config-backed list of available wallets
 * (≤3 EVM + ≤3 Solana), surfaced for BOTH the onboarding multi-wallet UI
 * (puzzle 5 phase 5D) and the per-session selection picker (phase 5C).
 *
 * Neutral module on purpose: the inventory is a global concept, not a
 * session-scope one, so onboarding components can consume it without
 * coupling to `session-wallets.ts` (Codex 5D wiring review). `listAvailable`
 * reads config inventory via `listWallets()` — no DB, no setup-complete
 * gate — so it works mid-onboarding too.
 */

import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { AvailableWalletsDto } from "@shared/schemas/wallets.js";
import { walletsKeys } from "./queryKeys.js";

const STALE_MS = 10_000;

export function availableWalletsOptions() {
  return queryOptions({
    queryKey: walletsKeys.available(),
    queryFn: () => window.vex.wallets.listAvailable({}),
    staleTime: STALE_MS,
  });
}

/** Inventory wallets available to pick from (session create) or extend (onboarding). */
export function useAvailableWallets(): UseQueryResult<Result<AvailableWalletsDto>> {
  return useQuery(availableWalletsOptions());
}
