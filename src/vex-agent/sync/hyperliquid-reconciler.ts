/**
 * Hyperliquid account reconciliation.
 *
 * This module is detection-only. It reads exchange state, emits synthetic
 * captures, and wakes/notifies the owning mission when protection needs
 * consolidation. It never resolves a private key and never signs.
 */

import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import { z } from "zod";

import { HyperliquidInfoClient } from "@tools/hyperliquid/info.js";
import { resolveHyperliquidNetwork } from "@tools/hyperliquid/constants.js";
import { normalizeProviderDecimal } from "@tools/hyperliquid/validation.js";
import {
  getActiveHyperliquidPerpTargets,
  getLatestSessionIdForPosition,
  type HyperliquidPerpTarget,
} from "@vex-agent/db/repos/activity.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as openPositionsRepo from "@vex-agent/db/repos/open-positions.js";
import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import { appendEngineMessage } from "@vex-agent/engine/events/index.js";
import { buildPositionProtectionSnapshot, type PositionProtectionSnapshot } from "@vex-agent/tools/protocols/hyperliquid/protection-snapshot.js";
import { recordSyntheticCapture } from "./synthetic-capture.js";
import logger from "@utils/logger.js";

const signedDecimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const unsignedDecimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);

const positionSchema = z.object({
  coin: z.string().min(1),
  szi: signedDecimal,
  entryPx: unsignedDecimal,
  unrealizedPnl: signedDecimal,
  cumFunding: z.object({ sinceOpen: signedDecimal }),
}).passthrough();
const clearinghouseStateSchema = z.object({
  assetPositions: z.array(z.object({ position: positionSchema }).passthrough()),
  marginSummary: z.object({ accountValue: signedDecimal.optional() }).passthrough().optional(),
  crossMarginSummary: z.object({ accountValue: signedDecimal.optional() }).passthrough().optional(),
  withdrawable: unsignedDecimal.optional(),
}).passthrough();
const userFillsSchema = z.array(z.object({ coin: z.string().min(1) }).passthrough());
const metaAndAssetCtxsSchema = z.tuple([
  z.object({ universe: z.array(z.object({ name: z.string().min(1) }).passthrough()) }).passthrough(),
  z.array(z.object({
    markPx: unsignedDecimal,
    openInterest: unsignedDecimal.optional(),
    prevDayPx: unsignedDecimal.optional(),
  }).passthrough()),
]);
const liquidationEventSchema = z.object({
  liquidation: z.object({ liquidated_user: z.string().min(1) }).passthrough(),
}).passthrough();

export interface HyperliquidReconcileResult {
  readonly checked: number;
  readonly captured: number;
  readonly closed: number;
  readonly cancelled: number;
  readonly liquidated: number;
  readonly consolidating: number;
  readonly unprotected: number;
  readonly skipped: number;
  readonly errors: number;
}

export interface HyperliquidReconcilerDeps {
  readonly createInfoClient: () => Pick<HyperliquidInfoClient, "clearinghouseState" | "frontendOpenOrders" | "userFills" | "metaAndAssetCtxs">;
  readonly getOpenPositions: typeof openPositionsRepo.getOpen;
  readonly getActiveTargets: typeof getActiveHyperliquidPerpTargets;
  readonly recordSyntheticCapture: typeof recordSyntheticCapture;
  readonly getLatestSessionIdForPosition: typeof getLatestSessionIdForPosition;
  readonly getActiveRunBySession: typeof missionRunsRepo.getActiveRunBySession;
  readonly getPendingForSession: typeof loopWakeRepo.getPendingForSession;
  readonly promotePendingWakeForSafety: typeof loopWakeRepo.promotePendingWakeForSafety;
  readonly enqueueWake: typeof loopWakeRepo.enqueue;
  readonly appendEngineMessage: typeof appendEngineMessage;
}

function productionDeps(): HyperliquidReconcilerDeps {
  return {
    createInfoClient: () => new HyperliquidInfoClient({ network: resolveHyperliquidNetwork() }),
    getOpenPositions: openPositionsRepo.getOpen,
    getActiveTargets: getActiveHyperliquidPerpTargets,
    recordSyntheticCapture,
    getLatestSessionIdForPosition,
    getActiveRunBySession: missionRunsRepo.getActiveRunBySession,
    getPendingForSession: loopWakeRepo.getPendingForSession,
    promotePendingWakeForSafety: loopWakeRepo.promotePendingWakeForSafety,
    enqueueWake: loopWakeRepo.enqueue,
    appendEngineMessage,
  };
}

/** A userEvents liquidation applies to positions discovered absent on the next pass. */
const liquidationSeenForWallet = new Set<string>();

/** Called only by the explicitly owned user-events subscription lifecycle. */
export function recordHyperliquidUserEvent(walletAddress: string, event: unknown): void {
  const parsed = liquidationEventSchema.safeParse(event);
  if (!parsed.success) return;
  if (parsed.data.liquidation.liquidated_user.toLowerCase() === walletAddress.toLowerCase()) {
    liquidationSeenForWallet.add(walletAddress.toLowerCase());
  }
}

/**
 * Reconcile currently tracked positions/resting entries. With neither open
 * local positions nor an active HL target, the function returns before making
 * any exchange request.
 */
export async function reconcileHyperliquid(
  deps: HyperliquidReconcilerDeps = productionDeps(),
): Promise<HyperliquidReconcileResult> {
  const result: MutableReconcileResult = emptyResult();
  const [openPositions, activeTargets] = await Promise.all([
    deps.getOpenPositions(undefined, "hyperliquid"),
    deps.getActiveTargets(),
  ]);
  const wallets = new Set([
    ...openPositions.map((position) => position.walletAddress),
    ...activeTargets.map((target) => target.walletAddress),
  ]);
  if (wallets.size === 0) return result;

  const info = deps.createInfoClient();
  let markets: HyperliquidMarketSnapshot;
  try {
    markets = extractMarketSnapshot(await info.metaAndAssetCtxs());
  } catch (error) {
    logger.warn("hyperliquid.reconcile.marks_failed", { error: errorMessage(error) });
    return { ...result, errors: 1 };
  }

  for (const walletAddress of wallets) {
    try {
      const [stateResponse, orders, fills] = await Promise.all([
        info.clearinghouseState(walletAddress),
        info.frontendOpenOrders(walletAddress),
        info.userFills(walletAddress),
      ]);
      const state = clearinghouseStateSchema.parse(stateResponse);
      const normalizedFills = userFillsSchema.parse(fills);
      await reconcileWallet({
        walletAddress,
        state,
        orders,
        fills: normalizedFills,
        marks: markets.marks,
        marketWatchlist: markets.watchlist,
        localPositions: openPositions.filter((position) => position.walletAddress === walletAddress),
        activeTargets: activeTargets.filter((target) => target.walletAddress === walletAddress),
        deps,
        result,
      });
    } catch (error) {
      result.errors += 1;
      logger.warn("hyperliquid.reconcile.wallet_failed", { error: errorMessage(error) });
    } finally {
      liquidationSeenForWallet.delete(walletAddress.toLowerCase());
    }
  }
  return result;
}

interface ReconcileWalletInput {
  readonly walletAddress: string;
  readonly state: z.infer<typeof clearinghouseStateSchema>;
  readonly orders: unknown;
  readonly fills: z.infer<typeof userFillsSchema>;
  readonly marks: ReadonlyMap<string, string>;
  readonly marketWatchlist: readonly HyperliquidMarketWatchlistItem[];
  readonly localPositions: readonly openPositionsRepo.Position[];
  readonly activeTargets: readonly HyperliquidPerpTarget[];
  readonly deps: HyperliquidReconcilerDeps;
  readonly result: MutableReconcileResult;
}

async function reconcileWallet(input: ReconcileWalletInput): Promise<void> {
  const remoteByCoin = new Map(
    input.state.assetPositions
      .map((entry) => entry.position)
      .filter((position) => !new Decimal(position.szi).isZero())
      .map((position) => [position.coin, position] as const),
  );
  const localByCoin = new Map(
    input.localPositions
      .map((position) => [coinForPosition(position), position] as const)
      .filter((entry): entry is readonly [string, openPositionsRepo.Position] => entry[0] !== null),
  );
  const targetByCoin = new Map(
    input.activeTargets
      .map((target) => [coinForTarget(target), target] as const)
      .filter((entry): entry is readonly [string, HyperliquidPerpTarget] => entry[0] !== null),
  );
  const coins = new Set([...remoteByCoin.keys(), ...localByCoin.keys(), ...targetByCoin.keys()]);

  for (const coin of coins) {
    input.result.checked += 1;
    const remotePosition = remoteByCoin.get(coin);
    const localPosition = localByCoin.get(coin) ?? null;
    const target = targetByCoin.get(coin) ?? null;
    if (remotePosition !== undefined) {
      const snapshot = buildPositionProtectionSnapshot(input.state, input.orders, coin);
      const capture = openCapture({
        walletAddress: input.walletAddress,
        coin,
        position: remotePosition,
        markPx: input.marks.get(coin),
        account: accountSnapshot(input.state),
        marketWatchlist: input.marketWatchlist,
        snapshot,
        fills: input.fills,
        localPosition,
      });
      const persisted = await captureIfChanged(capture, localPosition, input.deps, input.result);
      if (!persisted) continue;
      if (snapshot.state === "CONSOLIDATING" && metaString(capture, "protectionEscalation") === "UNPROTECTED") {
        input.result.unprotected += 1;
        await wakeOrNotifyUnprotected(capture, input.deps);
      } else if (snapshot.state === "CONSOLIDATING") {
        input.result.consolidating += 1;
        await wakeOrNotifyConsolidation(capture, input.deps);
      } else if (snapshot.state === "UNPROTECTED" || snapshot.state === "PARTIAL") {
        input.result.unprotected += 1;
        await wakeOrNotifyUnprotected(capture, input.deps);
      }
      continue;
    }

    if (localPosition !== null) {
      const liquidated = liquidationSeenForWallet.has(input.walletAddress.toLowerCase());
      const capture = closedCapture(localPosition, coin, liquidated ? "liquidated" : "closed");
      if (await captureIfChanged(capture, localPosition, input.deps, input.result)) {
        if (liquidated) input.result.liquidated += 1;
        else input.result.closed += 1;
      }
      continue;
    }

    // A tracked pending entry that no longer exists on the venue was cancelled
    // outside Vex. Capture the fact even though no position row was ever open.
    if (target !== null && !hasOpenOrder(input.orders, coin)) {
      const capture = cancelledCapture(target, coin);
      if (await captureIfChanged(capture, null, input.deps, input.result)) input.result.cancelled += 1;
    } else {
      input.result.skipped += 1;
    }
  }
}

async function captureIfChanged(
  capture: Record<string, unknown>,
  localPosition: openPositionsRepo.Position | null,
  deps: HyperliquidReconcilerDeps,
  result: MutableReconcileResult,
): Promise<boolean> {
  const version = metaString(capture, "reconcileVersion");
  if (localPosition !== null && stringField(localPosition.data, "reconcileVersion") === version) {
    result.skipped += 1;
    return false;
  }
  const executionId = await deps.recordSyntheticCapture({
    toolId: "hyperliquid_reconcile.position",
    namespace: "hyperliquid",
    tradeCapture: capture,
    source: "hyperliquid_reconciler",
  });
  if (executionId <= 0) throw new Error("Hyperliquid synthetic capture did not persist.");
  result.captured += 1;
  return true;
}

interface OpenCaptureInput {
  readonly walletAddress: string;
  readonly coin: string;
  readonly position: z.infer<typeof positionSchema>;
  readonly markPx: string | undefined;
  readonly account: HyperliquidAccountSnapshot;
  readonly marketWatchlist: readonly HyperliquidMarketWatchlistItem[];
  readonly snapshot: PositionProtectionSnapshot;
  readonly fills: z.infer<typeof userFillsSchema>;
  readonly localPosition: openPositionsRepo.Position | null;
}

function openCapture(input: OpenCaptureInput): Record<string, unknown> {
  if (input.markPx === undefined) throw new Error(`No mark price for ${input.coin}.`);
  const size = new Decimal(input.position.szi);
  const contracts = size.abs();
  const entryPx = providerUnsigned(input.position.entryPx, `Entry price for ${input.coin}`);
  const markPx = providerUnsigned(input.markPx, `Mark price for ${input.coin}`);
  const currentValueUsd = contracts.mul(markPx).toFixed();
  const unrealizedPnlUsd = new Decimal(input.position.unrealizedPnl)
    .plus(new Decimal(input.position.cumFunding.sinceOpen))
    .toFixed();
  const protectionState = input.snapshot.state;
  const fullPositionStop = input.snapshot.fullPositionStops[0]
    ?? input.snapshot.fixedSizeStops[0];
  const leverage = leverageDetails(input.position);
  const confirmedAt = new Date().toISOString();
  // A capture per reconciliation minute preserves freshness for the renderer
  // while a duplicate run in the same minute remains idempotent.
  const reconcileBucket = Math.floor(Date.now() / 60_000);
  const consolidationFailureCount = numericMeta(input.localPosition?.data, "consolidationFailureCount");
  const protectionEscalation = stringMeta(input.localPosition?.data, "protectionEscalation");
  const stableMeta = {
    coin: input.coin,
    contracts: contracts.toFixed(),
    signedSize: size.toFixed(),
    side: size.gt(0) ? "long" : "short",
    entryPx,
    markPx,
    liquidationPx: input.snapshot.liquidationPx,
    ...(fullPositionStop === undefined ? {} : { slPrice: fullPositionStop.triggerPx }),
    ...leverage,
    protectionState,
    cumFundingSinceOpen: input.position.cumFunding.sinceOpen,
    accountEquityUsd: input.account.equityUsd,
    accountWithdrawableUsd: input.account.withdrawableUsd,
    accountTotalUnrealizedPnlUsd: input.account.totalUnrealizedPnlUsd,
    marketWatchlist: input.marketWatchlist,
    reconcileBucket,
    recentFillCount: input.fills.filter((fill) => fill.coin === input.coin).length,
    ...(consolidationFailureCount > 0 ? { consolidationFailureCount } : {}),
    ...(protectionEscalation === "UNPROTECTED" ? { protectionEscalation } : {}),
  };
  const meta = { ...stableMeta, confirmedAt };
  return {
    type: "perps",
    chain: "hyperliquid",
    status: "open",
    walletAddress: input.walletAddress,
    positionKey: `hyperliquid:perp:${input.coin}:${input.walletAddress}`,
    instrumentKey: `hyperliquid:perp:${input.coin}`,
    inputValueUsd: contracts.mul(entryPx).toFixed(),
    unitPriceUsd: entryPx,
    currentValueUsd,
    unrealizedPnlUsd,
    valuationSource: "hyperliquid_clearinghouse",
    settlementAssetKey: "USDC",
    meta: { ...meta, reconcileVersion: versionFor({ status: "open", currentValueUsd, unrealizedPnlUsd, meta: stableMeta }) },
  };
}

function closedCapture(position: openPositionsRepo.Position, coin: string, status: "closed" | "liquidated"): Record<string, unknown> {
  const meta = { coin, contracts: position.contracts ?? "0", protectionState: "FLAT" };
  return {
    type: "perps",
    chain: "hyperliquid",
    status,
    walletAddress: position.walletAddress,
    positionKey: position.positionKey ?? position.externalId ?? `hyperliquid:perp:${coin}:${position.walletAddress}`,
    instrumentKey: position.instrumentKey ?? `hyperliquid:perp:${coin}`,
    valuationSource: "hyperliquid_clearinghouse",
    settlementAssetKey: "USDC",
    meta: { ...meta, reconcileVersion: versionFor({ status, meta }) },
  };
}

function cancelledCapture(target: HyperliquidPerpTarget, coin: string): Record<string, unknown> {
  const meta = { coin, contracts: "0", protectionState: "FLAT" };
  return {
    type: "perps",
    chain: "hyperliquid",
    status: "cancelled",
    walletAddress: target.walletAddress,
    positionKey: target.positionKey,
    instrumentKey: target.instrumentKey ?? `hyperliquid:perp:${coin}`,
    valuationSource: "hyperliquid_clearinghouse",
    settlementAssetKey: "USDC",
    meta: { ...meta, reconcileVersion: versionFor({ status: "cancelled", meta }) },
  };
}

async function wakeOrNotifyConsolidation(capture: Record<string, unknown>, deps: HyperliquidReconcilerDeps): Promise<void> {
  await wakeOrNotify(capture, deps, "consolidation", "CONSOLIDATING protection detected. Use hyperliquid.perp.setTpsl to place a full-position stop, then cancel the transient fixed-size child before any other Hyperliquid action.");
}

async function wakeOrNotifyUnprotected(capture: Record<string, unknown>, deps: HyperliquidReconcilerDeps): Promise<void> {
  await wakeOrNotify(capture, deps, "unprotected", "UNPROTECTED Hyperliquid position detected. Verify protection immediately; if it cannot be restored, propose a reduce-only close.");
}

async function wakeOrNotify(
  capture: Record<string, unknown>,
  deps: HyperliquidReconcilerDeps,
  kind: "consolidation" | "unprotected",
  notice: string,
): Promise<void> {
  const positionKey = stringField(capture, "positionKey");
  const coin = metaString(capture, "coin");
  if (positionKey === undefined || coin === undefined) return;
  const sessionId = await deps.getLatestSessionIdForPosition(positionKey);
  if (sessionId === null) {
    logger.warn("hyperliquid.reconcile.no_owning_session", { coin, kind });
    return;
  }
  const run = await deps.getActiveRunBySession(sessionId);
  const pending = await deps.getPendingForSession(sessionId);
  if (run?.status === "paused_wake" && pending !== null) {
    const promoted = await deps.promotePendingWakeForSafety(sessionId, run.id);
    if (promoted) return;
  }
  if (run?.status === "paused_wake" && pending === null) {
    const row = await deps.enqueueWake({
      sessionId,
      missionRunId: run.id,
      dueAt: new Date(),
      reason: `hyperliquid ${kind}: ${coin}`,
      payload: { trigger: `hyperliquid_${kind}`, positionKey, coin },
    });
    if (row !== null) return;
  }
  await deps.appendEngineMessage(sessionId, `[Engine: hyperliquid_${kind} — ${notice}]`, {
    source: "engine",
    messageType: "hyperliquid_protection",
    visibility: "internal",
    payload: { kind, positionKey, coin },
  });
}

interface HyperliquidMarketWatchlistItem {
  readonly coin: string;
  readonly midPx: string;
  readonly change24hPct: string | null;
  readonly openInterestUsd: string | null;
}

interface HyperliquidMarketSnapshot {
  readonly marks: ReadonlyMap<string, string>;
  readonly watchlist: readonly HyperliquidMarketWatchlistItem[];
}

interface HyperliquidAccountSnapshot {
  readonly equityUsd: string | null;
  readonly withdrawableUsd: string | null;
  readonly totalUnrealizedPnlUsd: string | null;
}

const REQUIRED_WATCHLIST_COINS = new Set(["BTC", "ETH", "SOL", "HYPE"]);
const WATCHLIST_TOP_BY_OPEN_INTEREST = 12;
const WATCHLIST_MAX = 16;

/**
 * Reuse the reconciler's existing metaAndAssetCtxs response for watchlist OI.
 * The main push service supplies fresher mids from allMids; no extra endpoint
 * is added for the renderer. Change is included only when `prevDayPx` is in
 * this already-fetched provider payload.
 */
function extractMarketSnapshot(response: unknown): HyperliquidMarketSnapshot {
  const [meta, contexts] = metaAndAssetCtxsSchema.parse(response);
  const marks = new Map<string, string>();
  const candidates: HyperliquidMarketWatchlistItem[] = [];
  for (const [index, universe] of meta.universe.entries()) {
    const context = contexts[index];
    if (context === undefined) continue;
    const markPx = providerUnsigned(context.markPx, `Mark price for ${universe.name}`);
    marks.set(universe.name, markPx);
    const openInterestUsd = context.openInterest === undefined
      ? null
      : new Decimal(providerUnsigned(context.openInterest, `Open interest for ${universe.name}`))
        .mul(markPx)
        .toFixed();
    const previous = context.prevDayPx === undefined
      ? null
      : providerUnsigned(context.prevDayPx, `Previous-day price for ${universe.name}`);
    const change24hPct = previous === null || new Decimal(previous).isZero()
      ? null
      : new Decimal(markPx).minus(previous).div(previous).mul(100).toFixed();
    candidates.push({ coin: universe.name, midPx: markPx, change24hPct, openInterestUsd });
  }
  candidates.sort((left, right) => {
    const leftOi = left.openInterestUsd === null ? new Decimal(-1) : new Decimal(left.openInterestUsd);
    const rightOi = right.openInterestUsd === null ? new Decimal(-1) : new Decimal(right.openInterestUsd);
    return rightOi.comparedTo(leftOi) || left.coin.localeCompare(right.coin);
  });
  const selected = candidates.slice(0, WATCHLIST_TOP_BY_OPEN_INTEREST);
  const selectedCoins = new Set(selected.map((item) => item.coin));
  for (const requiredCoin of REQUIRED_WATCHLIST_COINS) {
    if (selectedCoins.has(requiredCoin)) continue;
    const required = candidates.find((item) => item.coin === requiredCoin);
    if (required !== undefined) {
      selected.push(required);
      selectedCoins.add(requiredCoin);
    }
  }
  return { marks, watchlist: selected.slice(0, WATCHLIST_MAX) };
}

function accountSnapshot(
  state: z.infer<typeof clearinghouseStateSchema>,
): HyperliquidAccountSnapshot {
  const margin = state.marginSummary ?? state.crossMarginSummary;
  const equityUsd = margin?.accountValue === undefined
    ? null
    : normalizeOptionalProviderDecimal(margin.accountValue) ?? null;
  const withdrawableUsd = state.withdrawable === undefined
    ? null
    : normalizeOptionalProviderDecimal(state.withdrawable) ?? null;
  try {
    const totalUnrealizedPnlUsd = state.assetPositions.reduce(
      (total, item) => total.plus(item.position.unrealizedPnl),
      new Decimal(0),
    ).toFixed();
    return { equityUsd, withdrawableUsd, totalUnrealizedPnlUsd };
  } catch {
    return { equityUsd, withdrawableUsd, totalUnrealizedPnlUsd: null };
  }
}

function hasOpenOrder(orders: unknown, coin: string): boolean {
  return Array.isArray(orders) && orders.some((order) => {
    const candidate = record(order);
    return candidate?.coin === coin && candidate.reduceOnly !== true;
  });
}
function coinForPosition(position: openPositionsRepo.Position): string | null {
  const dataCoin = typeof position.data.coin === "string" ? position.data.coin : null;
  if (dataCoin !== null) return dataCoin;
  const match = position.instrumentKey?.match(/^hyperliquid:perp:([^:]+)$/);
  return match?.[1] ?? null;
}
function coinForTarget(target: HyperliquidPerpTarget): string | null {
  const match = target.instrumentKey?.match(/^hyperliquid:perp:([^:]+)$/);
  return match?.[1] ?? null;
}
function leverageDetails(position: Record<string, unknown>): { readonly leverage?: string; readonly marginMode?: "cross" | "isolated" } {
  const leverage = record(position.leverage);
  const rawValue = leverage?.value;
  const rawType = leverage?.type;
  const value = typeof rawValue === "string"
    ? normalizeOptionalProviderDecimal(rawValue)
    : typeof rawValue === "number" ? normalizeOptionalProviderDecimal(String(rawValue)) : undefined;
  const marginMode = rawType === "cross" ? "cross" : rawType === "isolated" ? "isolated" : undefined;
  return {
    ...(value === undefined ? {} : { leverage: value }),
    ...(marginMode === undefined ? {} : { marginMode }),
  };
}
function normalizeOptionalProviderDecimal(value: string): string | undefined {
  try {
    return normalizeProviderDecimal(value, "Hyperliquid leverage");
  } catch {
    return undefined;
  }
}
function providerUnsigned(value: string, label: string): string { return normalizeProviderDecimal(value, label); }
function versionFor(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function stringField(value: Record<string, unknown>, key: string): string | undefined { const candidate = value[key]; return typeof candidate === "string" ? candidate : undefined; }
function metaString(capture: Record<string, unknown>, key: string): string | undefined { const meta = record(capture.meta); return meta === null ? undefined : stringField(meta, key); }
function stringMeta(meta: Record<string, unknown> | undefined, key: string): string | undefined { const value = meta?.[key]; return typeof value === "string" ? value : undefined; }
function numericMeta(meta: Record<string, unknown> | undefined, key: string): number { const value = meta?.[key]; return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0; }
function record(value: unknown): Record<string, unknown> | null { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
function emptyResult(): MutableReconcileResult { return { checked: 0, captured: 0, closed: 0, cancelled: 0, liquidated: 0, consolidating: 0, unprotected: 0, skipped: 0, errors: 0 }; }
type MutableReconcileResult = { -readonly [K in keyof HyperliquidReconcileResult]: HyperliquidReconcileResult[K] };
