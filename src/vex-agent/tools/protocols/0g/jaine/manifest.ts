/**
 * Jaine DEX (0G Network) protocol manifest — aggregates all module manifests.
 *
 * 7 modules: pools, pool, tokens, dex, swap, allowance, w0g.
 * Subgraph queries (read-only) + on-chain execution (mutating).
 */

import type { ProtocolToolManifest } from "../../types.js";
import { POOLS_TOOLS } from "./manifests/pools.js";
import { POOL_TOOLS } from "./manifests/pool.js";
import { TOKENS_TOOLS } from "./manifests/tokens.js";
import { DEX_TOOLS } from "./manifests/dex.js";
import { SWAP_TOOLS } from "./manifests/swap.js";
import { ALLOWANCE_TOOLS } from "./manifests/allowance.js";
import { W0G_TOOLS } from "./manifests/w0g.js";

export const JAINE_TOOLS: readonly ProtocolToolManifest[] = [
  ...POOLS_TOOLS,
  ...POOL_TOOLS,
  ...TOKENS_TOOLS,
  ...DEX_TOOLS,
  ...SWAP_TOOLS,
  ...ALLOWANCE_TOOLS,
  ...W0G_TOOLS,
];
