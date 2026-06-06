/**
 * Khalani wallet balance scanning + aggregation.
 *
 * BARREL: the implementation was split by concern into `./balances/*` for
 * maintainability. This module re-exports the IDENTICAL public surface (no
 * renamed/added/removed exports, no behaviour change):
 *
 * - types:    `./balances/types.ts`     (BalanceChainError, BalanceChainSelection,
 *                                          TokenBalanceScanResult)
 * - selection:`./balances/selection.ts` (parseBalanceChainSelection,
 *                                          getSelectedChainIdsForFamily)
 * - scan:     `./balances/scan.ts`      (getTokenBalancesAcrossChains + native
 *                                          top-up / error-classification helpers)
 * - aggregate:`./balances/aggregate.ts` (calculateTokensTotalUsd)
 *
 * Shared private helpers (`tokenUsd`, `chainNotInRegistryError`) live in exactly
 * one module — `./balances/_shared.ts` — and are intentionally NOT re-exported.
 */

export type {
  BalanceChainError,
  BalanceChainSelection,
  TokenBalanceScanResult,
} from "./balances/types.js";

export {
  parseBalanceChainSelection,
  getSelectedChainIdsForFamily,
} from "./balances/selection.js";

export { getTokenBalancesAcrossChains } from "./balances/scan.js";

export { calculateTokensTotalUsd } from "./balances/aggregate.js";
