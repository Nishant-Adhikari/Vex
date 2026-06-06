/**
 * Surface pin for the DexScreener `validation.ts` barrel after the
 * resource-grouped structural split into `validation/`.
 *
 * Guards the PUBLIC export surface against drift: the exact 14-key set, the
 * `typeof` of each export (all functions), and a TYPE-LEVEL compile assertion
 * that the generic `validateWsHandshake<T>` still returns `WsHandshake<T>` (the
 * runtime key pin cannot prove the generic relationship — only `tsc` can).
 */

import { describe, expect, it } from "vitest";
import * as barrel from "@tools/dexscreener/validation.js";
import type { WsHandshake } from "@tools/dexscreener/types.js";

// ── Exact key pin ───────────────────────────────────────────────────

const EXPECTED_KEYS = [
  "validateAdsResponse",
  "validateBoostsResponse",
  "validateCommunityTakeoversResponse",
  "validateOrdersResponse",
  "validatePairsResponse",
  "validateProfilesResponse",
  "validateSearchResponse",
  "validateTokensPairsResponse",
  "validateTokensResponse",
  "validateWsAd",
  "validateWsBoost",
  "validateWsCommunityTakeover",
  "validateWsHandshake",
  "validateWsProfile",
] as const;

describe("dexscreener validation barrel surface", () => {
  it("exposes exactly the expected 14 exports", () => {
    expect(Object.keys(barrel).sort()).toEqual([...EXPECTED_KEYS]);
  });

  it("every export is a function", () => {
    for (const key of Object.keys(barrel)) {
      expect(typeof (barrel as Record<string, unknown>)[key]).toBe("function");
    }
  });
});

// ── Type-level assertion: validateWsHandshake<T> => WsHandshake<T> ───
//
// These never run; they exist so `tsc` fails if the generic signature drifts.

interface SomeType {
  readonly tag: "some";
  readonly value: number;
}

type AssertEqual<A, B> = (<G>() => G extends A ? 1 : 2) extends <G>() => G extends B ? 1 : 2
  ? true
  : false;

// The return type of the generic instantiation must be EXACTLY WsHandshake<SomeType>.
type WsHandshakeReturn = ReturnType<typeof barrel.validateWsHandshake<SomeType>>;
type _AssertWsHandshakeReturn = AssertEqual<WsHandshakeReturn, WsHandshake<SomeType>>;
const _wsHandshakeReturnHolds: _AssertWsHandshakeReturn = true;
void _wsHandshakeReturnHolds;

// The item validator parameter must be typed as `(item: unknown) => T`.
type WsHandshakeItemValidator = Parameters<typeof barrel.validateWsHandshake<SomeType>>[1];
type _AssertItemValidator = AssertEqual<WsHandshakeItemValidator, (item: unknown) => SomeType>;
const _itemValidatorHolds: _AssertItemValidator = true;
void _itemValidatorHolds;
