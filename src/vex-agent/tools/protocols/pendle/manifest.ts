/**
 * Pendle protocol manifest — fixed-yield PT + variable YT + PY mint/redeem + LP
 * single-token add/remove across 11 chains.
 *
 * Read: yields discovery + position valuation. Mutating: PT quote (records the
 * prequote), buy, early-exit sell, and matured redeem; YT quote, buy, and
 * early-exit sell; PY quote, mint (token → PT+YT), and pre-expiry redeem (PT+YT →
 * token); LP quote, single-token add (token → LP) and remove (LP → token); and a
 * claim income-sweep. Every mutating path is approval-gated with provider "pendle"
 * and pins the canonical Pendle Router (PT/YT/PY/LP trades are also prequote-gated;
 * the claim income-sweep has no quote).
 */

import type { ProtocolToolManifest } from "../types.js";
import { PENDLE_READ_TOOLS } from "./manifests/read.js";
import { PENDLE_PT_TOOLS } from "./manifests/pt.js";
import { PENDLE_YT_TOOLS } from "./manifests/yt.js";
import { PENDLE_PY_TOOLS } from "./manifests/py.js";
import { PENDLE_LP_TOOLS } from "./manifests/lp.js";

export const PENDLE_TOOLS: readonly ProtocolToolManifest[] = [
  ...PENDLE_READ_TOOLS,
  ...PENDLE_PT_TOOLS,
  ...PENDLE_YT_TOOLS,
  ...PENDLE_PY_TOOLS,
  ...PENDLE_LP_TOOLS,
];
