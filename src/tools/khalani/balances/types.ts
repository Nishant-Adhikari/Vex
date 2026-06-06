/**
 * Public type surface for the Khalani balances modules.
 *
 * Moved VERBATIM from the original `balances.ts` god-file. Re-exported through
 * the `../balances.js` barrel so external importers keep the identical types.
 */

import type { ChainFamily, KhalaniToken } from "../types.js";

export interface BalanceChainError {
  chainId: number;
  chainName?: string;
  message: string;
}

export interface BalanceChainSelection {
  rawProvided: boolean;
  byFamily: ReadonlyMap<ChainFamily, readonly number[]>;
}

export interface TokenBalanceScanResult {
  address: string;
  family: ChainFamily;
  tokens: KhalaniToken[];
  scannedChainIds: number[];
  chainErrors: BalanceChainError[];
  totalUsd: number;
}
