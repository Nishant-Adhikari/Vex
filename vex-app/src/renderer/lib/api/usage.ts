/**
 * Usage TanStack Query hooks (agent integration puzzle 1).
 *
 * Read-only. Empty sessions resolve to all-zero totals + `null`
 * last-turn — the renderer renders an empty chip, never an error.
 */

import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import {
  USAGE_DEFAULT_CURRENCY,
  type LastTurnUsageResult,
  type SessionUsageTotalsDto,
} from "@shared/schemas/usage.js";
import { usageKeys } from "./queryKeys.js";

const STALE_MS = 5_000;

function sessionTotalsOptions(sessionId: string, currency: string) {
  return queryOptions({
    queryKey: usageKeys.sessionTotals(sessionId, currency),
    queryFn: () =>
      window.vex.usage.getSessionTotals({ sessionId, currency }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

function lastTurnOptions(sessionId: string, currency: string) {
  return queryOptions({
    queryKey: usageKeys.lastTurn(sessionId, currency),
    queryFn: () => window.vex.usage.getLastTurn({ sessionId, currency }),
    staleTime: STALE_MS,
    enabled: sessionId.length > 0,
  });
}

export function useSessionUsageTotals(
  sessionId: string | null,
  currency: string = USAGE_DEFAULT_CURRENCY,
): UseQueryResult<Result<SessionUsageTotalsDto>> {
  return useQuery(sessionTotalsOptions(sessionId ?? "", currency));
}

export function useLastTurnUsage(
  sessionId: string | null,
  currency: string = USAGE_DEFAULT_CURRENCY,
): UseQueryResult<Result<LastTurnUsageResult>> {
  return useQuery(lastTurnOptions(sessionId ?? "", currency));
}
