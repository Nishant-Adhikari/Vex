/**
 * Khalani balance aggregation.
 *
 * Moved VERBATIM from the original `balances.ts` god-file. `tokenUsd` is the
 * single-sourced shared pricing helper in `./_shared.js`, also used by the scan
 * path.
 */

import type { KhalaniToken } from "../types.js";
import { tokenUsd } from "./_shared.js";

export function calculateTokensTotalUsd(tokens: readonly KhalaniToken[]): number {
  return tokens.reduce((sum, token) => sum + tokenUsd(token), 0);
}
