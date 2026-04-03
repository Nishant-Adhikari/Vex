/**
 * ZaaS DEX catalog types — structured DEX entries for kyberswap.zap.list.
 *
 * Each chain has a curated list of DEXes with capability and verification info.
 * Source: KyberSwap ZaaS docs (supported-chains-dexes + dex-ids pages).
 */

export type ZapDexCapability = "zap-in" | "zap-out" | "zap-migrate-source" | "zap-migrate-destination";

export interface ZapDexEntry {
  /** Official KyberSwap ZaaS DEX ID (e.g. "DEX_UNISWAPV3"). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Which zap operations this DEX supports on this chain. */
  supports: ZapDexCapability[];
  /** Whether this DEX ID is confirmed in official docs. */
  verification: "verified" | "unverified";
  /** DexScreener dexId values for matching pair.dexId. */
  dexscreenerIds?: string[];
  /** DexScreener label values for matching pair.labels (e.g. ["v3"]). */
  dexscreenerLabels?: string[];
}

export interface ChainZapDexConfig {
  chain: string;
  lastVerified: string;
  source: string;
  dexes: readonly ZapDexEntry[];
}
