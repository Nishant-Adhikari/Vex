/**
 * Portfolio TanStack Query hook (stage 3).
 *
 * Read-only dual-scope POSITION portfolio. A `null` active session reads
 * the GLOBAL inventory portfolio; a non-null active session reads that
 * session's wallet-scope portfolio. The renderer derives the discriminated
 * input here — it never supplies a wallet address. Empty scopes resolve to
 * the empty portfolio DTO, never an error.
 *
 * Not rendered yet (stage 4 wires the panel).
 */

import {
  queryOptions,
  useQuery,
  type UseQueryResult,
} from "@tanstack/react-query";
import type { Result } from "@shared/ipc/result.js";
import type {
  PortfolioDto,
  PortfolioRange,
  PortfolioReadInput,
  PortfolioSeriesDto,
  PortfolioSeriesInput,
} from "@shared/schemas/portfolio.js";
import type { MovesDto } from "@shared/schemas/portfolio-moves.js";
import { portfolioKeys } from "./queryKeys.js";

const STALE_MS = 15_000;
const REFETCH_MS = 45_000;

function portfolioInput(activeSessionId: string | null): PortfolioReadInput {
  return activeSessionId === null
    ? { scope: "global" }
    : { scope: "session", sessionId: activeSessionId };
}

/**
 * Cache-key discriminator for a read input: the session id for `session`,
 * the wallet address for `wallet`, `null` for `global`. Keeps each wallet's
 * (and each session's) portfolio a distinct cache entry.
 */
function portfolioReadKey(input: PortfolioReadInput): string | null {
  switch (input.scope) {
    case "session":
      return input.sessionId;
    case "wallet":
      return input.walletAddress;
    default:
      return null;
  }
}

function portfolioScopedOptions(input: PortfolioReadInput) {
  return queryOptions({
    queryKey: portfolioKeys.read(input.scope, portfolioReadKey(input)),
    queryFn: () => window.vex.portfolio.read(input),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
  });
}

/**
 * Read a POSITION portfolio for an EXPLICIT scope input — global, a session,
 * or a single configured wallet (the per-wallet filter). The wallet address
 * is resolved server-side against the configured inventory (fail-closed), so
 * this hook cannot widen the read past the caller's own wallets. Keyed by
 * scope + (sessionId | walletAddress | global) so each scope is a distinct
 * cache entry.
 */
export function usePortfolioScoped(
  input: PortfolioReadInput,
): UseQueryResult<Result<PortfolioDto>> {
  return useQuery(portfolioScopedOptions(input));
}

export function usePortfolio(
  activeSessionId: string | null,
): UseQueryResult<Result<PortfolioDto>> {
  return usePortfolioScoped(portfolioInput(activeSessionId));
}

/**
 * Portfolio value time-series (the dashboard equity curve). GLOBAL by default,
 * or scoped to a single configured wallet when `walletAddress` is supplied (the
 * per-wallet filter — the address is resolved server-side against the configured
 * inventory, fail-closed, so this can never widen past the caller's wallets).
 * Read-only; an empty inventory resolves to `{ points: [] }`, never an error.
 * Keyed by scope + wallet + range so each (wallet, window) is a distinct cache
 * entry.
 */
function portfolioSeriesOptions(
  range: PortfolioRange,
  walletAddress: string | null,
) {
  const input: PortfolioSeriesInput =
    walletAddress !== null
      ? { scope: "wallet", walletAddress, range }
      : { scope: "global", range };
  const scopeKey = walletAddress !== null ? `wallet:${walletAddress}` : "global";
  return queryOptions({
    queryKey: portfolioKeys.series(scopeKey, range),
    queryFn: () => window.vex.portfolio.series(input),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
  });
}

export function usePortfolioSeries(
  range: PortfolioRange,
  walletAddress?: string | null,
): UseQueryResult<Result<PortfolioSeriesDto>> {
  return useQuery(portfolioSeriesOptions(range, walletAddress ?? null));
}

/**
 * MOVES (move 0.3) — the session's executed-trade activity from
 * `proj_activity`, scoped server-side to the session's wallets. Drives the
 * BOOK Moves block. Read-only; an empty scope resolves to `[]`, never an
 * error. The session id is required (MOVES are session-scoped — there is no
 * global feed).
 */
function movesOptions(sessionId: string) {
  return queryOptions({
    queryKey: portfolioKeys.moves(sessionId),
    queryFn: () => window.vex.portfolio.listMoves({ sessionId }),
    staleTime: STALE_MS,
    refetchInterval: REFETCH_MS,
    enabled: sessionId.length > 0,
  });
}

export function useMoves(
  sessionId: string,
): UseQueryResult<Result<MovesDto>> {
  return useQuery(movesOptions(sessionId));
}
