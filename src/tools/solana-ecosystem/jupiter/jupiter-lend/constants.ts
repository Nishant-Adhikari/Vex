/**
 * Stable Jupiter Lend constants and official program addresses.
 * Verified from Jupiter Lend docs on 2026-03-30.
 */

export const JUPITER_LEND_API_BASE_URL = "https://api.jup.ag/lend/v1";
export const JUPITER_LEND_EARN_API_BASE_URL = `${JUPITER_LEND_API_BASE_URL}/earn`;

export const JUPITER_LEND_PROGRAM_ADDRESSES = {
  lending: "jup3YeL8QhtSx1e253b2FDvsMNC87fDrgQZivbrndc9",
  liquidity: "jupeiUmn818Jg1ekPURTpr4mFo29p46vygyykFJ3wZC",
  lendingRewardsRateModel: "jup7TthsMgcR9Y3L277b8Eo9uboVSmu1utkuXHNUKar",
  oracle: "jupnw4B6Eqs7ft6rxpzYLJZYSnrpRgPcr589n5Kv4oc",
  vaults: "jupr81YtYssSyPt8jbnGuiWon5f6x9TcDEFxYe3Bdzi",
  flashloan: "jupgfSgfuAXv4B6R2Uxu85Z1qdzgju79s6MfZekN6XS",
} as const;

export const JUPITER_LEND_DEFERRED_AREAS = [
  "Borrow SDK and future Borrow REST endpoints",
  "Flashloan SDK flows",
  "Read SDK integrations for Earn, Borrow, and Liquidity analytics",
  "Oracle verification helpers",
  "CPI and on-chain integration helpers",
  "Advanced Lend guides that depend on Jupiter Lite API swap instructions",
] as const;
