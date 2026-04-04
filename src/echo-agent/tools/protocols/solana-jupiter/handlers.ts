/**
 * Solana/Jupiter protocol handlers — aggregator.
 * Split into modules: core (prices/tokens/swap), predict, lend.
 */

import type { ProtocolHandler } from "../types.js";
import { CORE_HANDLERS } from "./handlers/core.js";
import { PREDICT_HANDLERS } from "./handlers/predict.js";
import { LEND_HANDLERS } from "./handlers/lend.js";

export const SOLANA_JUPITER_HANDLERS: Record<string, ProtocolHandler> = {
  ...CORE_HANDLERS,
  ...PREDICT_HANDLERS,
  ...LEND_HANDLERS,
};
