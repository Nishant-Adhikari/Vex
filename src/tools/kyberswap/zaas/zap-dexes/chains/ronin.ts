import type { ChainZapDexConfig } from "../types.js";
const ALL_OPS = ["zap-in", "zap-out", "zap-migrate-source", "zap-migrate-destination"] as const;

export const RONIN_ZAP_DEXES: ChainZapDexConfig = {
  chain: "ronin", lastVerified: "2026-04-02", source: "KyberSwap ZaaS docs",
  dexes: [
    // unverified — supported-chains page shows Katana on Ronin but DEX ID mapping page
    // doesn't list explicit Katana ID. Needs live API confirmation before treating as canonical.
    { id: "DEX_KATANA_V2", name: "Katana V2", supports: [...ALL_OPS], verification: "unverified" },
    { id: "DEX_KATANA_V3", name: "Katana V3", supports: [...ALL_OPS], verification: "unverified" },
  ],
};
