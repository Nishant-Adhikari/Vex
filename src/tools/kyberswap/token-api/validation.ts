/**
 * Runtime validators for KyberSwap Token API responses.
 */

import { ErrorCodes } from "../../../errors.js";
import { isRecord, createFieldValidators } from "../../../utils/validation-helpers.js";
import type { KyberToken, KyberTokenSearchResponse, HoneypotFotInfo } from "./types.js";

const { asString, asNumber, asOptionalString, asOptionalNumber } = createFieldValidators(
  ErrorCodes.KYBER_TOKEN_SEARCH_FAILED, "KyberSwap Token API",
);

function parseToken(raw: unknown): KyberToken {
  if (!isRecord(raw)) {
    throw new Error("token must be an object");
  }
  return {
    address: asString(raw.address, "token.address"),
    symbol: asString(raw.symbol, "token.symbol"),
    name: asString(raw.name, "token.name"),
    decimals: asNumber(raw.decimals, "token.decimals"),
    marketCap: asOptionalNumber(raw.marketCap),
    isVerified: typeof raw.isVerified === "boolean" ? raw.isVerified : undefined,
    isWhitelisted: typeof raw.isWhitelisted === "boolean" ? raw.isWhitelisted : undefined,
    isStable: typeof raw.isStable === "boolean" ? raw.isStable : undefined,
  };
}

export function validateTokenSearchResponse(raw: unknown): KyberTokenSearchResponse {
  if (!isRecord(raw) || !isRecord(raw.data)) {
    throw new Error("Expected Token API search response with data wrapper");
  }
  const data = raw.data as Record<string, unknown>;
  const tokens = Array.isArray(data.tokens) ? data.tokens.map(parseToken) : [];
  const pagination = isRecord(data.pagination) ? data.pagination : {};

  return {
    data: {
      tokens,
      pagination: {
        totalItems: typeof pagination.totalItems === "number" ? pagination.totalItems : tokens.length,
      },
    },
  };
}

export function validateHoneypotFotResponse(raw: unknown): HoneypotFotInfo {
  if (!isRecord(raw)) {
    throw new Error("Expected honeypot/FOT response object");
  }
  return {
    isHoneypot: typeof raw.isHoneypot === "boolean" ? raw.isHoneypot : false,
    isFOT: typeof raw.isFOT === "boolean" ? raw.isFOT : false,
    tax: typeof raw.tax === "number" ? raw.tax : 0,
  };
}
