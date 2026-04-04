/**
 * Slop.money (0G Network) protocol handlers — aggregator.
 * Split into modules: view (read-only), mutate (create/trade/claim).
 */

import type { ProtocolHandler } from "../../types.js";
import { VIEW_HANDLERS } from "./handlers/view.js";
import { MUTATE_HANDLERS } from "./handlers/mutate.js";

export const SLOP_HANDLERS: Record<string, ProtocolHandler> = {
  ...VIEW_HANDLERS,
  ...MUTATE_HANDLERS,
};
