/**
 * Community takeover + ad validators.
 *
 * Strict `parseCommunityTakeover` / `parseAd` plus their array validators
 * (`validateCommunityTakeoversResponse` / `validateAdsResponse`). The two
 * parsers are re-used by the WS handshake (`validateWsCommunityTakeover` /
 * `validateWsAd`). Moved VERBATIM from the original `validation.ts`.
 */

import { z } from "zod";
import { VexError, ErrorCodes } from "../../../errors.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import type { DexAd, DexCommunityTakeover } from "../types.js";
import {
  asOptionalNumber,
  asOptionalString,
  asString,
  linksSchema,
  parseOrThrow,
  strDefault,
} from "./_shared.js";

// ---------------------------------------------------------------------------
// Community Takeovers
// ---------------------------------------------------------------------------

const communityTakeoverObjectSchema: z.ZodType<DexCommunityTakeover> = z
  .object({
    url: asString("cto.url"),
    chainId: asString("cto.chainId"),
    tokenAddress: asString("cto.tokenAddress"),
    icon: strDefault(""),
    header: asOptionalString,
    description: asOptionalString,
    links: linksSchema,
    claimDate: asString("cto.claimDate"),
  })
  .transform((c) => ({
    url: c.url,
    chainId: c.chainId,
    tokenAddress: c.tokenAddress,
    icon: c.icon,
    header: c.header,
    description: c.description,
    links: c.links,
    claimDate: c.claimDate,
  }));

export function parseCommunityTakeover(raw: unknown): DexCommunityTakeover {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: community takeover must be an object");
  }
  return parseOrThrow(communityTakeoverObjectSchema, raw);
}

export function validateCommunityTakeoversResponse(raw: unknown): DexCommunityTakeover[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected community takeovers array");
  }
  return raw.map(parseCommunityTakeover);
}

// ---------------------------------------------------------------------------
// Ads
// ---------------------------------------------------------------------------

const adObjectSchema: z.ZodType<DexAd> = z
  .object({
    url: asString("ad.url"),
    chainId: asString("ad.chainId"),
    tokenAddress: asString("ad.tokenAddress"),
    date: asString("ad.date"),
    type: asString("ad.type"),
    durationHours: asOptionalNumber,
    impressions: asOptionalNumber,
  })
  .transform((a) => ({
    url: a.url,
    chainId: a.chainId,
    tokenAddress: a.tokenAddress,
    date: a.date,
    type: a.type,
    durationHours: a.durationHours,
    impressions: a.impressions,
  }));

export function parseAd(raw: unknown): DexAd {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: ad must be an object");
  }
  return parseOrThrow(adObjectSchema, raw);
}

export function validateAdsResponse(raw: unknown): DexAd[] {
  if (!Array.isArray(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener response: expected ads array");
  }
  return raw.map(parseAd);
}
