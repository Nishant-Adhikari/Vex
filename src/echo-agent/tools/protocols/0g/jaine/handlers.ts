/**
 * Jaine DEX (0G Network) protocol handlers — aggregator.
 * Split into modules: read (subgraph queries), swap (execution + allowance + w0g).
 */

import type { ProtocolHandler } from "../../types.js";
import { READ_HANDLERS } from "./handlers/read.js";
import { SWAP_HANDLERS } from "./handlers/swap.js";

export const JAINE_HANDLERS: Record<string, ProtocolHandler> = {
  ...READ_HANDLERS,
  ...SWAP_HANDLERS,
};
