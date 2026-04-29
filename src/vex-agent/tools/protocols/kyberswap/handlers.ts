/**
 * KyberSwap protocol handlers — aggregator.
 * Split into modules: swap (chains/tokens/swap), limit-order, zap.
 */

import type { ProtocolHandler } from "../types.js";
import { SWAP_HANDLERS } from "./handlers/swap.js";
import { LIMIT_ORDER_HANDLERS } from "./handlers/limit-order.js";
import { ZAP_HANDLERS } from "./handlers/zap.js";

export const KYBERSWAP_HANDLERS: Record<string, ProtocolHandler> = {
  ...SWAP_HANDLERS,
  ...LIMIT_ORDER_HANDLERS,
  ...ZAP_HANDLERS,
};
