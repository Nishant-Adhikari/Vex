import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const SOURCE_ONLY = ["zap-migrate-source"] as const;

export const OPTIMISM_ZAP_DEXES: ChainZapDexConfig = {
  chain: "optimism", lastVerified: "2026-04-02", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_UNISWAPV3", name: "Uniswap V3", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_UNISWAP_V4", name: "Uniswap V4", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_UNISWAPV2", name: "Uniswap V2", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SUSHISWAPV2", name: "SushiSwap V2", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_VELODROME_SLIPSTREAM", name: "Velodrome Slipstream", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_VELODROMEBASIC", name: "Velodrome Basic", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SWAPMODEV3", name: "SwapMode V3", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_GAMMA", name: "Gamma", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SOLIDLY", name: "Solidly", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_CURVE", name: "Curve", supports: [...SOURCE_ONLY], verification: "verified" },
    { id: "DEX_BALANCER", name: "Balancer", supports: [...SOURCE_ONLY], verification: "verified" },
  ],
};
