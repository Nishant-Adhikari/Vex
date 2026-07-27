/**
 * Mission results capture — opens the ledger row when a run starts and
 * closes it when the run finalizes. Both are FAIL-SOFT: any error is
 * logged and swallowed so bankroll accounting can never break a mission's
 * lifecycle. Deps are injected for tests; production wires the real
 * repos/helpers.
 *
 * Start and finalize run in different turns, so nothing is held in memory —
 * the row is keyed on `mission_run_id` and re-addressed at close.
 *
 * Naming: this produces a "mission result (ETH)" — an honest, ETH-
 * denominated PnL record. Never call it "performance" here or in any
 * consumer (agent behavior is directional and carries risk; a single
 * numeric ledger is not a guarantee of future results).
 *
 * Never logs a wallet address — only ids (mission/run/session) and error
 * messages.
 */

import { randomUUID } from "node:crypto";
import { getMission, type Mission } from "../../db/repos/missions.js";
import { getRun as getMissionRun } from "../../db/repos/mission-runs.js";
import {
  listSimPositionsForRun,
  sumRealizedPnlForRun,
} from "../../db/repos/sim-ledger.js";
import { resolveLocalChainId } from "../../../tools/evm-chains/registry.js";
import { readEthBankroll, readEthBankrollOnChain, type OpenPosition } from "./bankroll.js";
import { countMissionTrades } from "./mission-metrics.js";
import {
  openMissionResult,
  closeMissionResult,
  getResultForRun,
  type MissionResultOutcome,
} from "../../db/repos/mission-results.js";
import logger from "@utils/logger.js";

const GOAL_SNIPPET_MAX = 240;

export interface CaptureDeps {
  getMission: typeof getMission;
  /** Live on-chain bankroll (accurate basis); null on RPC failure. */
  readBankrollOnChain: typeof readEthBankrollOnChain;
  /** `proj_balances` projection — fail-soft fallback + source of prices/open positions. */
  readBankroll: typeof readEthBankroll;
  openResult: typeof openMissionResult;
  closeResult: typeof closeMissionResult;
  getResult: typeof getResultForRun;
  countTrades: typeof countMissionTrades;
  /** Reads the run's frozen mode so the ledger row can be badged simulator. */
  getRun: typeof getMissionRun;
  listSimPositionsForRun: typeof listSimPositionsForRun;
  sumRealizedPnlForRun: typeof sumRealizedPnlForRun;
}

// Built lazily (inside each function's try) rather than at module load: some
// runner tests partially-mock the repo modules, and a top-level object
// literal would touch those bindings at import time. Resolving inside the
// try keeps the access under the fail-soft guard.
function productionDeps(): CaptureDeps {
  return {
    getMission,
    readBankrollOnChain: readEthBankrollOnChain,
    readBankroll: readEthBankroll,
    openResult: openMissionResult,
    closeResult: closeMissionResult,
    getResult: getResultForRun,
    countTrades: countMissionTrades,
    getRun: getMissionRun,
    listSimPositionsForRun,
    sumRealizedPnlForRun,
  };
}

/** Pure PnL: ETH delta + percent vs start. Null when either side is unknown. */
export function computePnl(
  startEth: number | null,
  endEth: number | null,
): { pnlEth: number | null; pnlPct: number | null } {
  if (startEth === null || endEth === null) return { pnlEth: null, pnlPct: null };
  const pnlEth = endEth - startEth;
  const pnlPct = startEth > 0 ? (pnlEth / startEth) * 100 : null;
  return { pnlEth, pnlPct };
}

function asOpenPositions(value: unknown): OpenPosition[] {
  if (!Array.isArray(value)) return [];
  return value.filter((row): row is OpenPosition => (
    typeof row === "object"
      && row !== null
      && typeof (row as Record<string, unknown>).address === "string"
      && typeof (row as Record<string, unknown>).amount === "number"
  ));
}

export function computeMissionOpenPositions(
  startPositions: unknown,
  currentPositions: readonly OpenPosition[] | null | undefined,
): OpenPosition[] {
  if (!Array.isArray(currentPositions) || currentPositions.length === 0) return [];
  const startByAddress = new Map<string, OpenPosition>();
  for (const position of asOpenPositions(startPositions)) {
    startByAddress.set(position.address.toLowerCase(), position);
  }

  const attributed: OpenPosition[] = [];
  for (const position of currentPositions) {
    const start = startByAddress.get(position.address.toLowerCase());
    const startAmount = start?.amount ?? 0;
    const deltaAmount = position.amount - startAmount;
    if (!(deltaAmount > 0)) continue;
    const deltaValueUsd =
      position.valueUsd === null || position.amount <= 0
        ? position.valueUsd
        : position.valueUsd * (deltaAmount / position.amount);
    attributed.push({
      ...position,
      amount: deltaAmount,
      valueUsd: deltaValueUsd,
    });
  }
  return attributed;
}

/** The mission's primary wallet + resolved local chain id, or null if either is absent/unresolvable. */
function resolveWalletChain(
  mission: Pick<Mission, "allowedWallets" | "allowedChains">,
): { wallet: string; chainId: number } | null {
  const wallet = mission.allowedWallets[0];
  const chainKey = mission.allowedChains[0];
  if (!wallet || !chainKey) return null;
  const chainId = resolveLocalChainId(chainKey);
  if (chainId === undefined) return null;
  return { wallet, chainId };
}

function parseUsdStartingCapital(
  mission: Pick<Mission, "capitalSourceJson">,
): number | null {
  const raw = (mission.capitalSourceJson as Record<string, unknown>)?.amount;
  if (typeof raw !== "string") return null;
  const match = raw.match(/([0-9]+(?:\.[0-9]+)?)/);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function computeSimulatorStartBankrollEth(
  mission: Pick<Mission, "capitalSourceJson">,
  ethPriceUsd: number | null | undefined,
): number | null {
  if (ethPriceUsd === null || ethPriceUsd === undefined || !(ethPriceUsd > 0)) {
    return null;
  }
  const usdAmount = parseUsdStartingCapital(mission);
  if (usdAmount === null) return null;
  return usdAmount / ethPriceUsd;
}

function simulatorOpenPositionsToLedgerRows(
  positions: Awaited<ReturnType<typeof listSimPositionsForRun>>,
): OpenPosition[] {
  return positions
    .filter((row) => row.status === "open" && row.qty > 0)
    .map((row) => ({
      symbol: row.tokenSymbol,
      address: row.tokenAddress,
      amount: row.qty,
      valueUsd: null,
    }));
}

/** Open the ledger row at run start (fail-soft). */
export async function captureMissionStart(
  args: { missionId: string; runId: string; sessionId: string },
  injected?: CaptureDeps,
): Promise<void> {
  try {
    const deps = injected ?? productionDeps();
    const mission = await deps.getMission(args.missionId);
    if (!mission) return;
    const wc = resolveWalletChain(mission);
    if (!wc) return;
    // START bankroll from a LIVE on-chain read (accurate basis) so start and
    // end are measured the same way; fall back to the projection if the RPC
    // read fails. The projection is read regardless for the start
    // open-position bag list, which the on-chain read does not carry (it
    // reports openPositions: []).
    const onChain = await deps.readBankrollOnChain(wc.wallet, wc.chainId);
    const projection = await deps.readBankroll(wc.wallet, wc.chainId);
    const run = await deps.getRun(args.runId);
    const bankroll =
      run?.mode === "simulator"
        ? {
            bankrollEth: computeSimulatorStartBankrollEth(
              mission,
              projection?.ethPriceUsd ?? onChain?.ethPriceUsd ?? null,
            ),
          }
        : (onChain ?? projection);
    await deps.openResult({
      simulated: run?.mode === "simulator",
      id: `mres-${randomUUID()}`,
      missionId: args.missionId,
      missionRunId: args.runId,
      sessionId: args.sessionId,
      walletAddress: wc.wallet,
      chainId: wc.chainId,
      goalSnippet: mission.goal?.slice(0, GOAL_SNIPPET_MAX) ?? null,
      bankrollStartEth: bankroll?.bankrollEth ?? null,
      ethPriceUsdStart: projection?.ethPriceUsd ?? onChain?.ethPriceUsd ?? null,
      // Bags held at START (pre-existing dust) so finalize counts only NEW ones.
      startPositions: projection?.openPositions ?? null,
    });
  } catch (err) {
    logger.warn("mission.results.capture_start_failed", {
      runId: args.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Close the ledger row at finalize with PnL + trade count (fail-soft). */
export async function captureMissionFinal(
  args: {
    missionId: string;
    runId: string;
    sessionId: string;
    outcome: Exclude<MissionResultOutcome, "running">;
    stopReason: string | null;
  },
  injected?: CaptureDeps,
): Promise<void> {
  try {
    const deps = injected ?? productionDeps();
    const mission = await deps.getMission(args.missionId);
    const wc = mission ? resolveWalletChain(mission) : null;
    if (!wc) return;
    const existing = await deps.getResult(args.runId, wc.wallet);
    if (!existing) return; // never opened or not owned by this mission wallet -> nothing to close
    const run = await deps.getRun(args.runId);
    // END bankroll from a LIVE on-chain read (the projection lags the trades
    // the mission just made and can report a false-zero PnL); fall back to
    // the projection if the RPC read fails. The projection is read regardless
    // for the price + open-position bag list, which the on-chain read does
    // not carry.
    const onChain = await deps.readBankrollOnChain(wc.wallet, wc.chainId);
    const projection = await deps.readBankroll(wc.wallet, wc.chainId);
    const simulatorPositions =
      run?.mode === "simulator" ? await deps.listSimPositionsForRun(args.runId) : [];
    const simulatorRealizedPnl =
      run?.mode === "simulator" ? await deps.sumRealizedPnlForRun(args.runId) : null;
    const endEth =
      run?.mode === "simulator"
        ? (
            existing.bankrollStartEth !== null
            && simulatorRealizedPnl !== null
          )
            ? existing.bankrollStartEth + simulatorRealizedPnl
            : null
        : ((onChain ?? projection)?.bankrollEth ?? null);
    const { pnlEth, pnlPct } = computePnl(existing.bankrollStartEth, endEth);
    const missionOpenPositions =
      run?.mode === "simulator"
        ? simulatorOpenPositionsToLedgerRows(simulatorPositions)
        : computeMissionOpenPositions(
            existing.startPositions,
            projection?.openPositions ?? null,
          );
    const trades = await deps.countTrades(
      args.sessionId,
      existing.startedAt,
      new Date().toISOString(),
    );
    await deps.closeResult({
      missionRunId: args.runId,
      outcome: args.outcome,
      stopReason: args.stopReason,
      bankrollEndEth: endEth,
      ethPriceUsdEnd: projection?.ethPriceUsd ?? onChain?.ethPriceUsd ?? null,
      pnlEth,
      pnlPct,
      trades,
      wins: 0,
      losses: 0,
      rotations: 0,
      vetoes: 0,
      openPositions: missionOpenPositions,
    });
  } catch (err) {
    logger.warn("mission.results.capture_final_failed", {
      runId: args.runId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
