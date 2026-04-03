import type { ChainZapDexConfig } from "../types.js";

const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const SOURCE_ONLY = ["zap-migrate-source"] as const;

export const POLYGON_ZAP_DEXES: ChainZapDexConfig = {
  chain: "polygon",
  lastVerified: "2026-04-02",
  source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_UNISWAPV3", name: "Uniswap V3", supports: [...ALL_OPS], verification: "verified", dexscreenerIds: ["uniswap"], dexscreenerLabels: ["v3"] },
    { id: "DEX_UNISWAP_V4", name: "Uniswap V4", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_UNISWAPV2", name: "Uniswap V2", supports: [...ALL_OPS], verification: "verified", dexscreenerIds: ["uniswap"], dexscreenerLabels: ["v2"] },
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified", dexscreenerIds: ["sushiswap"], dexscreenerLabels: ["v3"] },
    { id: "DEX_SUSHISWAPV2", name: "SushiSwap V2", supports: [...ALL_OPS], verification: "verified", dexscreenerIds: ["sushiswap"], dexscreenerLabels: ["v2"] },
    { id: "DEX_QUICKSWAPV3ALGEBRA", name: "QuickSwap V3 (Algebra)", supports: [...ALL_OPS], verification: "verified", dexscreenerIds: ["quickswap"], dexscreenerLabels: ["v3"] },
    { id: "DEX_QUICKSWAPV2", name: "QuickSwap V2", supports: [...ALL_OPS], verification: "verified", dexscreenerIds: ["quickswap"], dexscreenerLabels: ["v2"] },
    { id: "DEX_GAMMA", name: "Gamma", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_STEER", name: "Steer", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_CURVE", name: "Curve", supports: [...SOURCE_ONLY], verification: "verified" },
    { id: "DEX_BALANCER", name: "Balancer", supports: [...SOURCE_ONLY], verification: "verified" },
  ],
};
