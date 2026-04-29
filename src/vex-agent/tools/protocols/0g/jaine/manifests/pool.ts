import type { ProtocolToolManifest } from "../../../types.js";

export const POOL_TOOLS: readonly ProtocolToolManifest[] = [
  {
    toolId: "jaine.pool.info",
    namespace: "jaine",
    lifecycle: "active",
    description: "Detailed pool data — TVL, volume, fees, tick, token prices, liquidity, LP count, creation time.",
    mutating: false,
    params: [
      { key: "poolId", type: "string", required: true, description: "Pool contract address (0x...)." },
    ],
    exampleParams: { poolId: "0xabc..." },
  },
  {
    toolId: "jaine.pool.days",
    namespace: "jaine",
    lifecycle: "active",
    description: "Pool daily OHLCV data — open, high, low, close prices plus TVL, volume, fees, and tx count per day.",
    mutating: false,
    params: [
      { key: "poolId", type: "string", required: true, description: "Pool contract address (0x...)." },
      { key: "limit", type: "number", description: "Number of days to return (default: 30)." },
      { key: "skip", type: "number", description: "Number of days to skip for pagination." },
    ],
    exampleParams: { poolId: "0xabc...", limit: 7 },
  },
  {
    toolId: "jaine.pool.hours",
    namespace: "jaine",
    lifecycle: "active",
    description: "Pool hourly data — OHLCV prices, TVL, volume, fees per hour. Useful for intraday analysis.",
    mutating: false,
    params: [
      { key: "poolId", type: "string", required: true, description: "Pool contract address (0x...)." },
      { key: "limit", type: "number", description: "Number of hours to return (default: 24)." },
      { key: "skip", type: "number", description: "Number of hours to skip for pagination." },
    ],
    exampleParams: { poolId: "0xabc...", limit: 24 },
  },
  {
    toolId: "jaine.pool.swaps",
    namespace: "jaine",
    lifecycle: "active",
    description: "Recent swap transactions for a pool — amounts, USD value, sender, recipient, price after swap.",
    mutating: false,
    params: [
      { key: "poolId", type: "string", required: true, description: "Pool contract address (0x...)." },
      { key: "limit", type: "number", description: "Number of swaps to return (default: 20)." },
      { key: "skip", type: "number", description: "Number of swaps to skip for pagination." },
    ],
    exampleParams: { poolId: "0xabc...", limit: 20 },
  },
  {
    toolId: "jaine.pool.mints",
    namespace: "jaine",
    lifecycle: "active",
    description: "Liquidity mint (add) events for a pool — amounts, USD value, tick range, owner address.",
    mutating: false,
    params: [
      { key: "poolId", type: "string", required: true, description: "Pool contract address (0x...)." },
      { key: "limit", type: "number", description: "Number of events to return (default: 20)." },
      { key: "skip", type: "number", description: "Number of events to skip for pagination." },
    ],
    exampleParams: { poolId: "0xabc...", limit: 20 },
  },
  {
    toolId: "jaine.pool.burns",
    namespace: "jaine",
    lifecycle: "active",
    description: "Liquidity burn (remove) events for a pool — amounts, USD value, tick range, owner address.",
    mutating: false,
    params: [
      { key: "poolId", type: "string", required: true, description: "Pool contract address (0x...)." },
      { key: "limit", type: "number", description: "Number of events to return (default: 20)." },
      { key: "skip", type: "number", description: "Number of events to skip for pagination." },
    ],
    exampleParams: { poolId: "0xabc...", limit: 20 },
  },
  {
    toolId: "jaine.pool.collects",
    namespace: "jaine",
    lifecycle: "active",
    description: "Fee collect events for a pool — amounts collected per token, USD value, tick range, owner.",
    mutating: false,
    params: [
      { key: "poolId", type: "string", required: true, description: "Pool contract address (0x...)." },
      { key: "limit", type: "number", description: "Number of events to return (default: 20)." },
      { key: "skip", type: "number", description: "Number of events to skip for pagination." },
    ],
    exampleParams: { poolId: "0xabc...", limit: 20 },
  },
];
