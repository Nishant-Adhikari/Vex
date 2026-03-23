/**
 * Shared CLI helpers for KyberSwap commands.
 */

import { isAddress, getAddress, type Address } from "viem";
import { EchoError, ErrorCodes } from "../../errors.js";
import { resolveChainSlug, slugToChainId, getChainFeatures } from "../../kyberswap/chains.js";
import { NATIVE_TOKEN_ADDRESS } from "../../kyberswap/constants.js";
import { getKyberTokenApiClient } from "../../kyberswap/token-api/client.js";
import type { KyberChainSlug } from "../../kyberswap/types.js";

/** Resolve --chain option to validated KyberChainSlug. */
export function resolveChain(chainInput: string): KyberChainSlug {
  return resolveChainSlug(chainInput);
}

/** Resolve --chain and get chain ID. */
export function resolveChainWithId(chainInput: string): { slug: KyberChainSlug; chainId: number } {
  const slug = resolveChainSlug(chainInput);
  return { slug, chainId: slugToChainId(slug) };
}

/** Ensure chain supports a feature, or throw. */
export function requireFeature(slug: KyberChainSlug, feature: "aggregator" | "limitOrder" | "zaas"): void {
  const features = getChainFeatures(slug);
  if (!features[feature]) {
    throw new EchoError(
      ErrorCodes.KYBER_UNSUPPORTED_CHAIN,
      `Chain "${slug}" does not support KyberSwap ${feature}`,
    );
  }
}

/**
 * Resolve a token identifier to an Address.
 * Accepts: hex address, "native"/"ETH", or searches by symbol via Token API.
 */
export async function resolveTokenAddress(input: string, chainId: number): Promise<Address> {
  const lower = input.toLowerCase();

  if (lower === "native" || lower === "eth") {
    return NATIVE_TOKEN_ADDRESS;
  }

  if (isAddress(input)) {
    return getAddress(input);
  }

  // Search by symbol via Token API
  const client = getKyberTokenApiClient();
  const tokens = await client.searchTokens(String(chainId), {
    name: input,
    isWhitelisted: true,
    pageSize: 1,
  });

  if (tokens.length === 0) {
    throw new EchoError(
      ErrorCodes.KYBER_TOKEN_NOT_FOUND,
      `Token "${input}" not found on chain ${chainId}`,
      "Provide a token address or try a different symbol.",
    );
  }

  return getAddress(tokens[0].address);
}

/** Format USD value for display. */
export function formatUsd(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (Number.isNaN(num)) return "$—";
  return `$${num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format gas estimate for display. */
export function formatGas(gas: string, gasUsd: string): string {
  return `${gas} gas (~${formatUsd(gasUsd)})`;
}
