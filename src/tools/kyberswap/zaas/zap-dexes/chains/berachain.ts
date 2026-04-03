import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;

export const BERACHAIN_ZAP_DEXES: ChainZapDexConfig = {
  chain: "berachain", lastVerified: "2026-04-02", source: "KyberSwap ZaaS docs",
  dexes: [
    { id: "DEX_KODIAK_V2", name: "Kodiak V2", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_KODIAK_V3", name: "Kodiak V3", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_BERAHUB", name: "BeraHub", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_9MM_V2", name: "9MM V2", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_9MM_V3", name: "9MM V3", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_ARBERA", name: "Arbera", supports: [...ALL_OPS], verification: "verified" },
    { id: "DEX_BROWNFI", name: "BrownFi V2", supports: [...ALL_OPS], verification: "verified" },
  ],
};
