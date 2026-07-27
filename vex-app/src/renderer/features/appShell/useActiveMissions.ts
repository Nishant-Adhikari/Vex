/**
 * `useActiveMissions` — data plumbing for the persistent Active Missions bar.
 *
 * Composes THREE existing read-only IPCs (no new main-process surface):
 *   1. `wallets.listAvailable` → the primary EVM wallet (the ledger is
 *      per-wallet + ETH-denominated, exactly as Mission History resolves it).
 *   2. `mission.listResults`   → that wallet's ledger; the rows still at
 *      `outcome='running'` are the candidate open/orphaned runs.
 *   3. `runtime.getState`      → per candidate SESSION, fanned out with
 *      `useQueries`, to prove whether a live run actually exists.
 *
 * The live-vs-orphaned split is the pure `classifyActiveMissions`; this hook
 * only gathers inputs and stays fail-soft — any query error collapses the bar
 * to nothing rather than blocking the shell.
 */

import { useMemo } from "react";
import { useQueries, useQuery } from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type { RuntimeStateDto } from "@shared/schemas/runtime.js";
import { useAvailableWallets } from "../../lib/api/wallet-inventory.js";
import { useSessionsList } from "../../lib/api/sessions.js";
import { missionKeys, runtimeKeys } from "../../lib/api/queryKeys.js";
import {
  classifyActiveMissions,
  type ActiveMission,
  type ActiveMissionRuntime,
} from "./activeMissionsModel.js";

/** Runtime fan-out cadence — cheap DB reads; catches a live→orphaned flip. */
const RUNTIME_POLL_MS = 8_000;
/** Ledger refresh cadence — surfaces a newly-started (or newly-orphaned) row. */
const LEDGER_POLL_MS = 15_000;

export interface UseActiveMissionsResult {
  readonly missions: readonly ActiveMission[];
  readonly isError: boolean;
}

export function useActiveMissions(): UseActiveMissionsResult {
  const walletsQuery = useAvailableWallets();
  const primaryWallet =
    walletsQuery.data && walletsQuery.data.ok
      ? (walletsQuery.data.data.evm[0] ?? null)
      : null;

  // Ledger read — the SAME cache key `useMissionResults` uses (so Mission
  // History and this bar share one entry), but with a poll: this bar is a live
  // safety net, so a mission started (or finalized) in another session must
  // surface without waiting on an unrelated focus/remount refetch. Sharing the
  // key means our poll also refreshes Mission History's view.
  const walletAddress = primaryWallet?.address ?? "";
  const resultsQuery = useQuery({
    queryKey: missionKeys.results(walletAddress),
    queryFn: () => window.vex.mission.listResults({ walletAddress }),
    enabled: walletAddress.length > 0,
    staleTime: 2_000,
    refetchInterval: LEDGER_POLL_MS,
  });
  const sessionsQuery = useSessionsList();

  // Candidate open/orphaned runs: ledger rows still marked running.
  const openRows = useMemo(() => {
    if (!resultsQuery.data || !resultsQuery.data.ok) return [];
    return resultsQuery.data.data.filter((r) => r.outcome === "running");
  }, [resultsQuery.data]);

  // Deduplicated session ids to fan runtime reads over (a session maps 1:1 to
  // a run, but dedupe defensively so two rows never double-fetch).
  const sessionIds = useMemo(
    () => Array.from(new Set(openRows.map((r) => r.sessionId))),
    [openRows],
  );

  const runtimeQueries = useQueries({
    queries: sessionIds.map((sessionId) => ({
      queryKey: runtimeKeys.state(sessionId),
      queryFn: () => window.vex.runtime.getState({ sessionId }),
      staleTime: 2_000,
      refetchInterval: RUNTIME_POLL_MS,
    })),
  });

  // Only successfully-resolved runtime reads populate the map. An unresolved
  // (loading/error) session id is deliberately absent, so the model shows it as
  // an UNVERIFIED live run rather than flashing it as orphaned.
  const runtimeBySession = useMemo(() => {
    const map = new Map<string, ActiveMissionRuntime>();
    sessionIds.forEach((id, i) => {
      const data = runtimeQueries[i]?.data;
      if (data && data.ok) {
        map.set(id, {
          hasActiveRun: data.data.hasActiveRun,
          status: data.data.status,
          leaseActive: data.data.leaseActive,
        });
      }
    });
    return map;
    // `runtimeQueries` identity churns each render; key the memo on the actual
    // resolved values (a compact signature) plus the id list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionIds, runtimeSignature(runtimeQueries)]);

  const labelBySession = useMemo(() => {
    const map = new Map<string, string | null>();
    if (sessionsQuery.data && sessionsQuery.data.ok) {
      for (const s of sessionsQuery.data.data) {
        map.set(s.id, s.title ?? s.initialGoal ?? null);
      }
    }
    return map;
  }, [sessionsQuery.data]);

  const missions = useMemo(
    () => classifyActiveMissions(openRows, runtimeBySession, labelBySession),
    [openRows, runtimeBySession, labelBySession],
  );

  // Fail-soft: a hard results/wallets error collapses the bar (isError → the
  // component renders nothing). A partial runtime-read failure is NOT an error
  // — those rows simply stay "running" (unverified) and the bar still shows.
  const isError =
    walletsQuery.isError ||
    resultsQuery.isError ||
    Boolean(resultsQuery.data && !resultsQuery.data.ok);

  return { missions, isError };
}

/**
 * Compact, stable-per-value signature of the runtime fan-out so the
 * `runtimeBySession` memo recomputes only when a resolved value actually
 * changes (not on every render's fresh query-array identity).
 */
function runtimeSignature(
  queries: readonly { readonly data?: Result<RuntimeStateDto> }[],
): string {
  return queries
    .map((q) => {
      const data = q.data;
      if (!data || !data.ok) return "?";
      return `${data.data.sessionId}:${data.data.hasActiveRun ? 1 : 0}:${data.data.leaseActive ? 1 : 0}:${data.data.status ?? "-"}`;
    })
    .join("|");
}
