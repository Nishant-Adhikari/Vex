/**
 * Token profile validator.
 *
 * Strict `parseProfile` plus the `validateProfilesResponse` array validator.
 * `parseProfile` is re-used by the WS handshake (`validateWsProfile`). Moved
 * VERBATIM from the original `validation.ts`.
 */

import { z } from "zod";
import { VexError, ErrorCodes } from "../../../errors.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import type { DexTokenProfile } from "../types.js";
import { asOptionalString, asString, linksSchema, parseOrThrow, strDefault } from "./_shared.js";

const profileObjectSchema: z.ZodType<DexTokenProfile> = z
  .object({
    url: asString("profile.url"),
    chainId: asString("profile.chainId"),
    tokenAddress: asString("profile.tokenAddress"),
    icon: strDefault(""),
    header: asOptionalString,
    description: asOptionalString,
    links: linksSchema,
  })
  .transform((p) => ({
    url: p.url,
    chainId: p.chainId,
    tokenAddress: p.tokenAddress,
    icon: p.icon,
    header: p.header,
    description: p.description,
    links: p.links,
  }));

export function parseProfile(raw: unknown): DexTokenProfile {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: profile must be an object");
  }
  return parseOrThrow(profileObjectSchema, raw);
}

export function validateProfilesResponse(raw: unknown): DexTokenProfile[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected profiles array");
  }
  return raw.map(parseProfile);
}
