import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;
const SOURCE_ONLY = ["zap-migrate-source"] as const;

export const BSC_ZAP_DEXES: ChainZapDexConfig = {
  chain: "bsc", lastVerified: "2026-04-02", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_UNISWAPV3", name: "Uniswap V3", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_UNISWAP_V4", name: "Uniswap V4", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_UNISWAPV2", name: "Uniswap V2", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_PANCAKESWAPV3", name: "PancakeSwap V3", supports: [...ALL_OPS], verification: "verified", dexscreenerIds: ["pancakeswap"] },
    { id: "DEX_PANCAKESWAPV2", name: "PancakeSwap V2", supports: [...ALL_OPS], verification: "verified", dexscreenerIds: ["pancakeswap"] },
    { id: "DEX_SUSHISWAPV3", name: "SushiSwap V3", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SUSHISWAPV2", name: "SushiSwap V2", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_THENAFUSION", name: "Thena Fusion", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_THENAALGEBRAINTEGRAL", name: "Thena Algebra Integral", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_GAMMA", name: "Gamma", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SOLIDLY", name: "Solidly", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SQUADSWAP_V2", name: "Squad Swap V2", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_CURVE", name: "Curve", supports: [...SOURCE_ONLY], verification: "verified" },
  ],
};
