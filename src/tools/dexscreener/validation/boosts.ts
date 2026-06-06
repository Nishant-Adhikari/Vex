/**
 * Boost validator.
 *
 * Strict `parseBoost` plus the `validateBoostsResponse` array validator.
 * `parseBoost` is re-used by the WS handshake (`validateWsBoost`). Moved
 * VERBATIM from the original `validation.ts`.
 */

import { z } from "zod";
import { VexError, ErrorCodes } from "../../../errors.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import type { DexBoost } from "../types.js";
import { asNumber, asOptionalString, asString, linksSchema, parseOrThrow } from "./_shared.js";

const boostObjectSchema: z.ZodType<DexBoost> = z
  .object({
    url: asString("boost.url"),
    chainId: asString("boost.chainId"),
    tokenAddress: asString("boost.tokenAddress"),
    amount: asNumber("boost.amount"),
    totalAmount: asNumber("boost.totalAmount"),
    icon: asOptionalString,
    header: asOptionalString,
    description: asOptionalString,
    links: linksSchema,
  })
  .transform((b) => ({
    url: b.url,
    chainId: b.chainId,
    tokenAddress: b.tokenAddress,
    amount: b.amount,
    totalAmount: b.totalAmount,
    icon: b.icon,
    header: b.header,
    description: b.description,
    links: b.links,
  }));

export function parseBoost(raw: unknown): DexBoost {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: boost must be an object");
  }
  return parseOrThrow(boostObjectSchema, raw);
}

export function validateBoostsResponse(raw: unknown): DexBoost[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected boosts array");
  }
  return raw.map(parseBoost);
}
