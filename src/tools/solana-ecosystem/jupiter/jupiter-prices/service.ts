/**
 * High-level Jupiter Price API V3 service.
 * Preserves full wire responses and adds optional token-resolution helpers.
 */

import { VexError, ErrorCodes } from "../../../../errors.js";
import { requireJupiterResolvedToken, resolveJupiterTokens } from "../jupiter-tokens/service.js";
import { jupiterPrices, jupiterPricesByMint } from "./client.js";
import type {
  JupiterPriceRequestParams,
  JupiterPriceResponse,
  JupiterResolvedPriceBatch,
  JupiterResolvedPriceResult,
  JupiterSinglePriceResult,
} from "./types.js";

function toSinglePriceResult(mint: string, raw: JupiterPriceResponse): JupiterSinglePriceResult {
  const price = raw[mint];

  return {
    mint,
    price,
    found: price != null,
    raw,
  };
}

function toResolvedPriceResult(
  query: string,
  mint: string,
  raw: JupiterPriceResponse,
  token: JupiterResolvedPriceResult["token"],
): JupiterResolvedPriceResult {
  const price = raw[mint];

  return {
    query,
    mint,
    token,
    price,
    found: price != null,
  };
}

export async function getJupiterPrices(params: JupiterPriceRequestParams): Promise<JupiterPriceResponse> {
  return jupiterPrices(params);
}

export async function getJupiterPricesByMint(mints: string[]): Promise<JupiterPriceResponse> {
  return jupiterPricesByMint(mints);
}

export async function getJupiterPriceByMint(mint: string): Promise<JupiterSinglePriceResult> {
  const raw = await jupiterPricesByMint([mint]);
  return toSinglePriceResult(mint, raw);
}

export async function getJupiterPriceForTokenQuery(query: string): Promise<JupiterResolvedPriceResult & {
  raw: JupiterPriceResponse;
}> {
  const token = await requireJupiterResolvedToken(query);
  const raw = await jupiterPricesByMint([token.address]);

  return {
    ...toResolvedPriceResult(query, token.address, raw, token),
    raw,
  };
}

export async function getJupiterPricesForTokenQueries(
  queries: string[],
): Promise<JupiterResolvedPriceBatch> {
  const resolvedTokens = await resolveJupiterTokens(queries);
  const missingQuery = queries.find((query) => !resolvedTokens.has(query));

  if (missingQuery) {
    throw new VexError(
      ErrorCodes.SOLANA_TOKEN_NOT_FOUND,
      `Token not found: ${missingQuery}`,
      "Use a mint address or check the token symbol spelling.",
    );
  }

  const uniqueMints = Array.from(new Set(
    queries.map((query) => resolvedTokens.get(query)!.address),
  ));
  const raw = await jupiterPricesByMint(uniqueMints);

  return {
    resolved: queries.map((query) => {
      const token = resolvedTokens.get(query)!;
      return toResolvedPriceResult(query, token.address, raw, token);
    }),
    raw,
  };
}

