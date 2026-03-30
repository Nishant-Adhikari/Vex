/**
 * Shared Solana-ecosystem types.
 * These are stable, protocol-agnostic primitives reused by Jupiter modules.
 */

import type { ChainFamily } from "../../khalani/types.js";

export interface TokenMetadata {
  chain: ChainFamily;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoUri?: string;
}

export interface TransferResult {
  signature: string;
  explorerUrl: string;
}
