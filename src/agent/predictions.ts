/**
 * Predictions panel state builders.
 *
 * Normalizes Jupiter Prediction and Polymarket into one UI-facing shape while
 * keeping them separate from wallet portfolio snapshots.
 */

import { getMarket as getJupiterMarket, getPositions as getJupiterPositions } from "../chains/solana/prediction-service.js";
import { getPolyClobClient } from "../polymarket/clob/client.js";
import { getPolyDataClient } from "../polymarket/data/client.js";
import { hasPolyClobCredentials } from "../polymarket/auth.js";
import logger from "../utils/logger.js";
import { requireEvmWallet, requireSolanaWallet } from "../wallet/multi-auth.js";
import type {
  PredictionOrder,
  PredictionPanelState,
  PredictionPosition,
  PredictionSource,
  PredictionSummary,
} from "./types.js";

function emptySummary(): PredictionSummary {
  return {
    totalValueUsd: 0,
    totalPnlUsd: 0,
    totalPnlPct: null,
    positionCount: 0,
    orderCount: 0,
    claimableCount: 0,
    redeemableCount: 0,
    mergeableCount: 0,
  };
}

function unavailableState(source: PredictionSource, warning: string): PredictionPanelState {
  return {
    source,
    available: false,
    summary: emptySummary(),
    positions: [],
    orders: [],
    liveStatus: {
      available: false,
      status: "disabled",
      lastEventAt: null,
      lastSyncAt: null,
      reason: warning,
    },
    asOf: new Date().toISOString(),
    warnings: [warning],
  };
}

function summarizePositions(source: PredictionSource, positions: PredictionPosition[], orders: PredictionOrder[]): PredictionSummary {
  const totalValueUsd = positions.reduce((sum, position) => sum + position.valueUsd, 0);
  const totalPnlUsd = positions.reduce((sum, position) => sum + position.pnlUsd, 0);
  const totalCostUsd = positions.reduce((sum, position) => sum + position.costUsd, 0);

  return {
    totalValueUsd,
    totalPnlUsd,
    totalPnlPct: totalCostUsd > 0 ? (totalPnlUsd / totalCostUsd) * 100 : null,
    positionCount: positions.length,
    orderCount: source === "polymarket" ? orders.length : 0,
    claimableCount: positions.filter((position) => position.flags.claimable).length,
    redeemableCount: positions.filter((position) => position.flags.redeemable).length,
    mergeableCount: positions.filter((position) => position.flags.mergeable).length,
  };
}

export async function getJupiterPredictionState(): Promise<PredictionPanelState> {
  let wallet;
  try {
    wallet = requireSolanaWallet();
  } catch (err) {
    const warning = err instanceof Error ? err.message : "Jupiter predictions unavailable.";
    return unavailableState("jupiter", warning);
  }

  const warnings: string[] = [];
  const rawPositions = await getJupiterPositions(wallet.address);
  const marketIds = [...new Set(rawPositions.map((position) => position.marketId).filter(Boolean))];
  const marketMap = new Map<string, Awaited<ReturnType<typeof getJupiterMarket>>>();

  if (marketIds.length > 0) {
    const results = await Promise.allSettled(
      marketIds.map(async (marketId) => {
        const market = await getJupiterMarket(marketId);
        marketMap.set(marketId, market);
      }),
    );

    for (const [index, result] of results.entries()) {
      if (result.status === "rejected") {
        const marketId = marketIds[index];
        warnings.push(`Failed to load Jupiter market details for ${marketId}.`);
        logger.warn("predictions.jupiter.market.failed", {
          marketId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });
      }
    }
  }

  const positions: PredictionPosition[] = rawPositions.map((position) => {
    const market = marketMap.get(position.marketId);
    const currentPrice = market
      ? (position.isYes ? market.buyYesPriceUsd : market.buyNoPriceUsd)
      : position.contracts > 0 ? position.valueUsd / position.contracts : 0;

    return {
      id: position.pubkey,
      source: "jupiter",
      marketId: position.marketId,
      title: market?.title ?? position.marketId,
      outcome: position.isYes ? "YES" : "NO",
      size: position.contracts,
      avgPrice: position.contracts > 0 ? position.totalCostUsd / position.contracts : 0,
      currentPrice,
      costUsd: position.totalCostUsd,
      valueUsd: position.valueUsd,
      pnlUsd: position.pnlUsd,
      pnlPct: position.pnlUsdPercent,
      flags: { claimable: position.claimable },
      meta: {
        positionPubkey: position.pubkey,
        claimable: position.claimable,
      },
    };
  });

  return {
    source: "jupiter",
    available: true,
    summary: summarizePositions("jupiter", positions, []),
    positions,
    orders: [],
    liveStatus: {
      available: false,
      status: "disabled",
      lastEventAt: null,
      lastSyncAt: null,
      reason: "Jupiter Prediction does not expose an official user WebSocket in this integration.",
    },
    asOf: new Date().toISOString(),
    warnings,
  };
}

export async function getPolymarketPredictionState(): Promise<PredictionPanelState> {
  let wallet;
  try {
    wallet = requireEvmWallet();
  } catch (err) {
    const warning = err instanceof Error ? err.message : "Polymarket predictions unavailable.";
    return unavailableState("polymarket", warning);
  }

  const warnings: string[] = [];
  const dataClient = getPolyDataClient();
  const clobClient = getPolyClobClient();
  const hasLiveOrders = hasPolyClobCredentials();

  const [positionsResult, valueResult, ordersResult] = await Promise.allSettled([
    dataClient.getPositions({
      user: wallet.address,
      limit: 50,
      sortBy: "CURRENT",
      sortDirection: "DESC",
    }),
    dataClient.getValue(wallet.address),
    hasLiveOrders ? clobClient.getOrders() : Promise.resolve(null),
  ]);

  const rawPositions = positionsResult.status === "fulfilled" ? positionsResult.value : [];
  if (positionsResult.status === "rejected") {
    warnings.push("Failed to load Polymarket positions.");
    logger.warn("predictions.polymarket.positions.failed", {
      error: positionsResult.reason instanceof Error ? positionsResult.reason.message : String(positionsResult.reason),
    });
  }

  const positions: PredictionPosition[] = rawPositions.map((position) => ({
    id: position.asset || `${position.conditionId}:${position.outcomeIndex}`,
    source: "polymarket",
    marketId: position.conditionId,
    title: position.title ?? position.conditionId,
    outcome: position.outcome ?? `Outcome ${position.outcomeIndex}`,
    size: position.size,
    avgPrice: position.avgPrice,
    currentPrice: position.curPrice,
    costUsd: position.totalBought || position.initialValue,
    valueUsd: position.currentValue,
    pnlUsd: position.cashPnl,
    pnlPct: position.percentPnl * 100,
    flags: {
      redeemable: position.redeemable,
      mergeable: position.mergeable,
    },
    meta: {
      asset: position.asset,
      proxyWallet: position.proxyWallet,
      slug: position.slug,
      endDate: position.endDate,
      negativeRisk: position.negativeRisk,
    },
  }));

  const totalValueUsd = valueResult.status === "fulfilled"
    ? valueResult.value.value
    : positions.reduce((sum, position) => sum + position.valueUsd, 0);

  if (valueResult.status === "rejected") {
    warnings.push("Failed to load Polymarket total value; using sum of open positions.");
    logger.warn("predictions.polymarket.value.failed", {
      error: valueResult.reason instanceof Error ? valueResult.reason.message : String(valueResult.reason),
    });
  }

  const rawOrders = ordersResult.status === "fulfilled" ? ordersResult.value?.data ?? [] : [];
  if (!hasLiveOrders) {
    warnings.push("Polymarket live orders require CLOB credentials.");
  } else if (ordersResult.status === "rejected") {
    warnings.push("Failed to load Polymarket open orders.");
    logger.warn("predictions.polymarket.orders.failed", {
      error: ordersResult.reason instanceof Error ? ordersResult.reason.message : String(ordersResult.reason),
    });
  }

  const orders: PredictionOrder[] = rawOrders.map((order) => ({
    id: order.id,
    source: "polymarket",
    marketId: order.market,
    outcome: order.outcome,
    side: order.side,
    price: Number(order.price),
    size: Number(order.original_size),
    matchedSize: Number(order.size_matched),
    status: order.status,
    orderType: order.order_type,
    createdAt: order.created_at > 0 ? new Date(order.created_at * 1000).toISOString() : null,
  }));

  const summary = summarizePositions("polymarket", positions, orders);
  summary.totalValueUsd = totalValueUsd;

  return {
    source: "polymarket",
    available: true,
    summary,
    positions,
    orders,
    liveStatus: {
      available: hasLiveOrders,
      status: hasLiveOrders ? "offline" : "disabled",
      lastEventAt: null,
      lastSyncAt: null,
      reason: hasLiveOrders ? "Waiting for live tracker." : "Polymarket CLOB credentials not configured.",
    },
    asOf: new Date().toISOString(),
    warnings,
  };
}
