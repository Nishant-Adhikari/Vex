import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;

export const SONIC_ZAP_DEXES: ChainZapDexConfig = {
  chain: "sonic", lastVerified: "2026-04-02", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_SHADOW_CL", name: "Shadow CL", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SHADOW_LEGACY", name: "Shadow Legacy", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_SQUADSWAP_V3", name: "Squad Swap V3", supports: [...ALL_OPS], verification: "verified" },
  ],
};
