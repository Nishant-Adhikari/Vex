/**
 * Pendle protocol handlers — aggregates the read + PT module handler maps.
 */

import type { ProtocolHandler } from "../types.js";
import { PENDLE_READ_HANDLERS } from "./handlers/read.js";
import { PENDLE_PT_HANDLERS } from "./handlers/pt.js";
import { PENDLE_YT_HANDLERS } from "./handlers/yt.js";
import { PENDLE_PY_HANDLERS } from "./handlers/py.js";
import { PENDLE_LP_HANDLERS } from "./handlers/lp.js";

export const PENDLE_HANDLERS: Record<string, ProtocolHandler> = {
  ...PENDLE_READ_HANDLERS,
  ...PENDLE_PT_HANDLERS,
  ...PENDLE_YT_HANDLERS,
  ...PENDLE_PY_HANDLERS,
  ...PENDLE_LP_HANDLERS,
};
