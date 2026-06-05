/**
 * Transactions-view failure classifier (Stage 9).
 *
 * The `transactions` view's FAILURE half surfaces FAILED trade-impacting
 * mutation attempts (protocol_executions WHERE success = false). Not every
 * mutating tool is trade-impacting — only the ones whose canonical product is a
 * transaction product belong in the feed. This module derives, ONCE at load,
 * the allowlist of `tool_id`s that qualify, plus a `tool_id → product` map for
 * the productType filter on the failure half.
 *
 * Single source of truth (reused, not duplicated):
 *   - `MUTATION_MATRIX` (tools/protocols/mutation-matrix.ts) — every mutating
 *     tool's contract, incl. `expectedType` (string | string[]).
 *   - `TYPE_TO_PRODUCT` (sync/activity-populator.ts) — the same capture-type →
 *     product mapping the projector uses, so the failure half's derived product
 *     matches what the success half stores in proj_activity.product_type.
 *
 * A tool qualifies when its `expectedType` maps (via TYPE_TO_PRODUCT) to a
 * product in TRANSACTION_PRODUCTS. For dual-type tools (e.g. Polymarket
 * buy/sell → ["prediction", "order"]) the FIRST expectedType that maps to a
 * transaction product is the tool's derived product — deterministic and stable
 * with the matrix declaration order.
 */

import { MUTATION_MATRIX } from "@vex-agent/tools/protocols/mutation-matrix.js";
import { TYPE_TO_PRODUCT } from "@vex-agent/sync/activity-populator.js";

/**
 * Products that count as transactions for the unified feed. A failed mutation
 * whose derived product is NOT in this set (e.g. lend/stake/lp/reward, or a
 * utility tool) is excluded from the failure half.
 */
export const TRANSACTION_PRODUCTS: ReadonlySet<string> = new Set([
  "spot",
  "perps",
  "prediction",
  "bridge",
  "order",
]);

/** Derive a tool's transaction product from its expectedType, or null. */
function deriveTransactionProduct(expectedType: string | readonly string[]): string | null {
  const types = Array.isArray(expectedType) ? expectedType : [expectedType];
  for (const type of types) {
    const product = TYPE_TO_PRODUCT[type];
    if (product !== undefined && TRANSACTION_PRODUCTS.has(product)) {
      return product;
    }
  }
  return null;
}

/**
 * `tool_id → transaction product` for every trade-impacting mutation tool.
 * Tools that map to no transaction product are absent (read tools are never in
 * MUTATION_MATRIX; non-trade mutating tools like lend/stake/lp are filtered).
 */
export const FAILURE_TOOL_PRODUCTS: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (const [toolId, contract] of MUTATION_MATRIX) {
    const product = deriveTransactionProduct(contract.expectedType);
    if (product !== null) {
      map.set(toolId, product);
    }
  }
  return map;
})();

/** The full trade-impacting failure-tool allowlist (every key of the product map). */
export const FAILURE_TOOL_ALLOWLIST: readonly string[] = [...FAILURE_TOOL_PRODUCTS.keys()];

/**
 * The failure-tool allowlist scoped to a productType filter. When `productType`
 * is undefined the full allowlist is returned; when set, only the tools whose
 * derived product === productType (so the failure half filters by DERIVED
 * PRODUCT, never trade_side). An unknown productType yields an empty list →
 * the failure half matches nothing.
 */
export function failureToolsForProduct(productType?: string): readonly string[] {
  if (productType === undefined) return FAILURE_TOOL_ALLOWLIST;
  return FAILURE_TOOL_ALLOWLIST.filter((toolId) => FAILURE_TOOL_PRODUCTS.get(toolId) === productType);
}
