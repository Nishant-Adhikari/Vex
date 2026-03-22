/**
 * Shared formatting helpers for DexScreener CLI commands.
 */

import type { TableColumn } from "../../utils/ui.js";
import { colors } from "../../utils/ui.js";
import type { DexPair } from "../../dexscreener/types.js";

export const PAIR_COLUMNS: TableColumn[] = [
  { header: "Pair", width: 22 },
  { header: "Chain", width: 12 },
  { header: "DEX", width: 14 },
  { header: "Price USD", width: 14 },
  { header: "Vol 24h", width: 14 },
  { header: "Liq USD", width: 14 },
  { header: "Chg 24h", width: 10 },
];

function formatCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(2)}K`;
  return n.toFixed(2);
}

function formatPrice(price: string | null): string {
  if (!price) return "-";
  const n = Number(price);
  if (Number.isNaN(n)) return price;
  if (n < 0.000001) return n.toExponential(4);
  if (n < 0.01) return n.toFixed(8);
  if (n < 1) return n.toFixed(6);
  return `$${n.toFixed(4)}`;
}

function formatChange(change: Record<string, number> | null): string {
  if (!change || change.h24 === undefined) return "-";
  const val = change.h24;
  const str = `${val >= 0 ? "+" : ""}${val.toFixed(2)}%`;
  return val >= 0 ? colors.success(str) : colors.error(str);
}

export function formatPairRow(pair: DexPair): string[] {
  const pairName = `${pair.baseToken.symbol}/${pair.quoteToken.symbol ?? "?"}`;
  const vol24h = pair.volume.h24 !== undefined ? `$${formatCompact(pair.volume.h24)}` : "-";
  const liq = pair.liquidity?.usd != null ? `$${formatCompact(pair.liquidity.usd)}` : "-";

  return [
    pairName,
    pair.chainId,
    pair.dexId,
    formatPrice(pair.priceUsd),
    vol24h,
    liq,
    formatChange(pair.priceChange),
  ];
}
