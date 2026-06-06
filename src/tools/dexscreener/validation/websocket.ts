/**
 * WebSocket handshake validators.
 *
 * The generic `validateWsHandshake<T>` wrapper plus the per-channel item
 * validators, each delegating to the strict parser owned by its resource
 * module (profiles / boosts / community-ads). Moved VERBATIM from the original
 * `validation.ts`; the generic signature (returns `WsHandshake<T>`) is
 * preserved EXACTLY.
 */

import { VexError, ErrorCodes } from "../../../errors.js";
import { isRecord } from "../../../utils/validation-helpers.js";
import type {
  DexAd,
  DexBoost,
  DexCommunityTakeover,
  DexTokenProfile,
  WsHandshake,
} from "../types.js";
import { parseBoost } from "./boosts.js";
import { parseAd, parseCommunityTakeover } from "./community-ads.js";
import { parseProfile } from "./profiles.js";

export function validateWsHandshake<T>(
  raw: unknown,
  itemValidator: (item: unknown) => T,
): WsHandshake<T> {
  if (!isRecord(raw)) {
    throw new VexError(ErrorCodes.DEXSCREENER_INVALID_RESPONSE, "Invalid DexScreener WS handshake: expected object");
  }
  return {
    limit: typeof raw.limit === "number" ? raw.limit : 0,
    data: Array.isArray(raw.data) ? raw.data.map(itemValidator) : [],
  };
}

export function validateWsProfile(raw: unknown): DexTokenProfile {
  return parseProfile(raw);
}

export function validateWsBoost(raw: unknown): DexBoost {
  return parseBoost(raw);
}

export function validateWsCommunityTakeover(raw: unknown): DexCommunityTakeover {
  return parseCommunityTakeover(raw);
}

export function validateWsAd(raw: unknown): DexAd {
  return parseAd(raw);
}
