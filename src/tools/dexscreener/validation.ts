/**
 * Zod response schemas + validators for the DexScreener REST/WS API
 * (codex-002 Phase 2, full uniformity).
 *
 * BARREL: this module's implementation was split into the `validation/`
 * subdirectory grouped by resource (pairs/search/tokens, profiles, boosts,
 * orders, community+ads, websocket) with a single shared primitives module
 * (`validation/_shared.ts`). It re-exports the IDENTICAL public validator set so
 * `client.ts` / `ws-client.ts` call sites stay unchanged. Behavior is preserved
 * VERBATIM — same Zod schemas, refines, transforms, error messages and return
 * types. Wire types remain canonical in `types.ts` and are NOT re-exported here.
 */

export {
  validatePairsResponse,
  validateSearchResponse,
  validateTokensResponse,
  validateTokensPairsResponse,
} from "./validation/pairs.js";
export { validateProfilesResponse } from "./validation/profiles.js";
export { validateBoostsResponse } from "./validation/boosts.js";
export { validateOrdersResponse } from "./validation/orders.js";
export {
  validateCommunityTakeoversResponse,
  validateAdsResponse,
} from "./validation/community-ads.js";
export {
  validateWsHandshake,
  validateWsProfile,
  validateWsBoost,
  validateWsCommunityTakeover,
  validateWsAd,
} from "./validation/websocket.js";
