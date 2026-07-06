/**
 * Pendle projectors — map validated provider shapes into model-facing output
 * through the trusted-fields boundary (Wave-3 pattern).
 *
 * EVERY structural field is re-narrowed here: symbols/names are bounded +
 * sanitized, addresses are shape-checked, expiry is re-serialized to canonical
 * ISO, numbers are finite+bounded. A points-bearing market with a low headline
 * yield gets a `pointsWarning` so the model never presents points as yield.
 * Matured PT is valued at its ACCOUNTING/face value (Pendle `price.acc`), NEVER
 * the underlying spot (SIERRA evidence), and marked `redeemable` once now ≥
 * expiry.
 */

import { PENDLE_LOW_APY_THRESHOLD, PENDLE_POINTS_CATEGORY } from "@tools/pendle/constants.js";
import type {
  PendleAsset,
  PendleMarket,
  PendleMarketPosition,
} from "@tools/pendle/types.js";
import {
  trustedAddress,
  trustedCategoryIds,
  trustedIsoTimestamp,
  trustedNumber,
  trustedText,
} from "./trusted-fields.js";
import { stripChainPrefix } from "@tools/pendle/validation.js";

// ── markets → yields ────────────────────────────────────────────────

export interface ProjectedMarket {
  name: string | null;
  market: string | null;
  expiry: string | null;
  pt: string | null;
  yt: string | null;
  sy: string | null;
  underlyingAsset: string | null;
  liquidityUsd: number | null;
  impliedApy: number | null;
  categories: string[];
  /** Set when the market awards points AND its headline yield is low/misleading. */
  pointsWarning?: string;
}

export function projectMarket(market: PendleMarket): ProjectedMarket {
  const impliedApy = trustedNumber(market.details.impliedApy, 100);
  const categories = trustedCategoryIds(market.categoryIds);
  const projected: ProjectedMarket = {
    name: trustedText(market.name),
    market: trustedAddress(market.address),
    expiry: trustedIsoTimestamp(market.expiry),
    pt: trustedAddress(market.pt),
    yt: trustedAddress(market.yt),
    sy: trustedAddress(market.sy),
    underlyingAsset: trustedAddress(market.underlyingAsset),
    liquidityUsd: trustedNumber(market.details.liquidity),
    impliedApy,
    categories,
  };
  const awardsPoints = categories.includes(PENDLE_POINTS_CATEGORY);
  const lowYield = impliedApy === null || impliedApy < PENDLE_LOW_APY_THRESHOLD;
  if (awardsPoints && lowYield) {
    projected.pointsWarning =
      "This market awards POINTS, not a fixed yield. The headline implied APY is low — points are speculative and are NOT a guaranteed return.";
  }
  return projected;
}

/**
 * Comparator over the ranked market fields (`apy` or `liquidity`, descending).
 * Structural param so it also sorts chain-labeled rows in the merged multichain
 * `pendle.yields` view without duplicating the ordering rule.
 */
export function compareMarketsBy(sort: "liquidity" | "apy") {
  return (
    a: { impliedApy: number | null; liquidityUsd: number | null },
    b: { impliedApy: number | null; liquidityUsd: number | null },
  ): number => {
    if (sort === "apy") return (b.impliedApy ?? -Infinity) - (a.impliedApy ?? -Infinity);
    return (b.liquidityUsd ?? -Infinity) - (a.liquidityUsd ?? -Infinity);
  };
}

/** Sort projected markets by `liquidity` (default) or `apy`. */
export function projectMarkets(
  markets: readonly PendleMarket[],
  sort: "liquidity" | "apy",
): ProjectedMarket[] {
  return markets.map(projectMarket).sort(compareMarketsBy(sort));
}

// ── positions → value ───────────────────────────────────────────────

export interface ProjectedPtPosition {
  market: string | null;
  pt: string | null;
  ptSymbol: string | null;
  expiry: string | null;
  balance: string;
  /** Face/accounting value for a matured PT; dashboard valuation otherwise. */
  valueUsd: number | null;
  valuationBasis: "accounting" | "dashboard" | "unknown";
  redeemable: boolean;
}

/**
 * Project a wallet's open PT legs. `marketByAddress` maps a lowercase MARKET
 * address to its active market (for PT + expiry + symbol + face value);
 * `assetByAddress` maps a lowercase address to its asset (for `price.acc`).
 */
export function projectPtPositions(
  positions: readonly PendleMarketPosition[],
  marketByAddress: Map<string, PendleMarket>,
  assetByAddress: Map<string, PendleAsset>,
): ProjectedPtPosition[] {
  const now = Date.now();
  const out: ProjectedPtPosition[] = [];
  for (const pos of positions) {
    if (!pos.pt || pos.pt.balance === "0") continue;
    // marketId is `chainId-marketAddress`; recover the market to find the PT.
    const marketAddr = stripChainPrefix(pos.marketId);
    const resolved = marketAddr ? marketByAddress.get(marketAddr.toLowerCase()) : undefined;
    const ptAddr = resolved?.pt ?? null;
    const expiryMs = resolved?.expiry ? Date.parse(resolved.expiry) : NaN;
    const matured = Number.isFinite(expiryMs) && expiryMs <= now;

    const value = valuePtLeg(pos.pt.balance, pos.pt.valuationUsd, ptAddr, matured, assetByAddress);
    out.push({
      market: trustedAddress(resolved?.address ?? marketAddr),
      pt: trustedAddress(ptAddr),
      ptSymbol: ptAddr ? trustedText(assetByAddress.get(ptAddr.toLowerCase())?.symbol ?? null) : null,
      expiry: trustedIsoTimestamp(resolved?.expiry ?? null),
      balance: pos.pt.balance,
      valueUsd: value.valueUsd,
      valuationBasis: value.basis,
      redeemable: matured,
    });
  }
  return out;
}

// ── LP positions → value ─────────────────────────────────────────────

export interface ProjectedLpPosition {
  market: string | null;
  lpSymbol: string | null;
  expiry: string | null;
  balance: string;
  /** Dashboard valuation, else spot (balance × LP price); null when neither. */
  valueUsd: number | null;
  valuationBasis: "dashboard" | "spot" | "unknown";
  /**
   * True once now ≥ expiry. A matured LP can still be REMOVED (principal side) but
   * no longer earns swap fees or rewards — surfaced so the model never frames a
   * matured LP as still-earning.
   */
  matured: boolean;
}

/**
 * Project a wallet's open LP legs (the `lp` leg of each dashboard position).
 * `marketByAddress` maps a lowercase MARKET address to its active market (for
 * expiry + LP symbol); `assetByAddress` maps a lowercase address to its asset (for
 * the LP token spot price). The market address IS the LP token.
 */
export function projectLpPositions(
  positions: readonly PendleMarketPosition[],
  marketByAddress: Map<string, PendleMarket>,
  assetByAddress: Map<string, PendleAsset>,
): ProjectedLpPosition[] {
  const now = Date.now();
  const out: ProjectedLpPosition[] = [];
  for (const pos of positions) {
    if (!pos.lp || pos.lp.balance === "0") continue;
    const marketAddr = stripChainPrefix(pos.marketId);
    const resolved = marketAddr ? marketByAddress.get(marketAddr.toLowerCase()) : undefined;
    const expiryMs = resolved?.expiry ? Date.parse(resolved.expiry) : NaN;
    const matured = Number.isFinite(expiryMs) && expiryMs <= now;
    const lpAddr = resolved?.address ?? marketAddr;

    const value = valueLpLeg(pos.lp.balance, pos.lp.valuationUsd, lpAddr, assetByAddress);
    out.push({
      market: trustedAddress(resolved?.address ?? marketAddr),
      lpSymbol: lpAddr ? trustedText(assetByAddress.get(lpAddr.toLowerCase())?.symbol ?? null) : null,
      expiry: trustedIsoTimestamp(resolved?.expiry ?? null),
      balance: pos.lp.balance,
      valueUsd: value.valueUsd,
      valuationBasis: value.basis,
      matured,
    });
  }
  return out;
}

function valueLpLeg(
  balanceWei: string,
  dashboardUsd: number | null,
  lpAddr: string | null,
  assetByAddress: Map<string, PendleAsset>,
): { valueUsd: number | null; basis: ProjectedLpPosition["valuationBasis"] } {
  const dash = trustedNumber(dashboardUsd);
  if (dash !== null) return { valueUsd: dash, basis: "dashboard" };
  // Fallback: spot LP price (the market address) × human balance.
  if (lpAddr) {
    const asset = assetByAddress.get(lpAddr.toLowerCase());
    const price = trustedNumber(asset?.priceUsd ?? null, 1e12);
    const decimals = asset?.decimals ?? 18;
    if (price !== null) {
      const human = Number(balanceWei) / 10 ** decimals;
      if (Number.isFinite(human)) return { valueUsd: human * price, basis: "spot" };
    }
  }
  return { valueUsd: null, basis: "unknown" };
}

function valuePtLeg(
  balanceWei: string,
  dashboardUsd: number | null,
  ptAddr: string | null,
  matured: boolean,
  assetByAddress: Map<string, PendleAsset>,
): { valueUsd: number | null; basis: ProjectedPtPosition["valuationBasis"] } {
  // A MATURED PT is worth ~face: value it at the accounting price (price.acc)
  // scaled by the human balance — NEVER the underlying spot.
  if (matured && ptAddr) {
    const asset = assetByAddress.get(ptAddr.toLowerCase());
    const acc = trustedNumber(asset?.priceAcc ?? null, 1e9);
    const decimals = asset?.decimals ?? 18;
    if (acc !== null) {
      const human = Number(balanceWei) / 10 ** decimals;
      if (Number.isFinite(human)) return { valueUsd: human * acc, basis: "accounting" };
    }
  }
  const dash = trustedNumber(dashboardUsd);
  if (dash !== null) return { valueUsd: dash, basis: "dashboard" };
  return { valueUsd: null, basis: "unknown" };
}
