/**
 * Behaviour-equivalence battery for the Zod-converted KyberSwap Common Service
 * validator (codex-002 Phase 2). Expected outputs are derived by reading the
 * ORIGINAL hand-written logic:
 *
 *   - parseChainInfo: non-record -> PLAIN Error "chain info must be an object";
 *     `state` validated via asString FIRST (throws VexError(KYBER_API_ERROR)
 *     "Invalid KyberSwap Common Service response: missing chain.state" on
 *     missing/empty/non-string), then chainId(asNumber)/chainName/displayName;
 *     a present non-enum `state` string maps to "inactive".
 *   - validateSupportedChainsResponse: non-record OR data-not-array -> PLAIN
 *     Error "Expected supported chains response with data array"; else
 *     data.map(parseChainInfo) (strict per element, NO filtering).
 *   - asNumber accepts ±Infinity, rejects NaN (proves z.number() was NOT used).
 */

import { describe, it, expect } from "vitest";
import { validateSupportedChainsResponse } from "@tools/kyberswap/common/validation.js";
import { VexError, ErrorCodes } from "../../errors.js";

const MISSING = (field: string) =>
  `Invalid KyberSwap Common Service response: missing ${field}`;

function chain(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    chainId: 1,
    chainName: "ethereum",
    displayName: "Ethereum",
    state: "active",
    ...overrides,
  };
}

describe("validateSupportedChainsResponse — equivalence", () => {
  // --- valid ---------------------------------------------------------------
  it("parses a fully valid chain array and strips unknown keys", () => {
    const result = validateSupportedChainsResponse({
      data: [chain({ extraneous: "drop-me" }), chain({ chainId: 56, chainName: "bsc", displayName: "BSC" })],
    });
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      chainId: 1,
      chainName: "ethereum",
      displayName: "Ethereum",
      state: "active",
    });
    expect(result[0]).not.toHaveProperty("extraneous");
    expect(result[1].chainId).toBe(56);
  });

  it("accepts all three enum states verbatim", () => {
    for (const state of ["active", "inactive", "new"] as const) {
      const [info] = validateSupportedChainsResponse({ data: [chain({ state })] });
      expect(info.state).toBe(state);
    }
  });

  // --- state mapping (present non-enum string -> "inactive") ---------------
  it("maps a present non-enum state string to inactive", () => {
    const [info] = validateSupportedChainsResponse({ data: [chain({ state: "unknown_state" })] });
    expect(info.state).toBe("inactive");
  });

  // --- root-shape guards: PLAIN Error, exact messages ----------------------
  it("throws PLAIN Error (not VexError) on non-record root", () => {
    for (const bad of [null, undefined, 42, "str", [], true]) {
      let caught: unknown;
      try {
        validateSupportedChainsResponse(bad);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(VexError);
      expect((caught as Error).message).toBe("Expected supported chains response with data array");
    }
  });

  it("throws PLAIN Error on missing / non-array data", () => {
    for (const bad of [{}, { data: "not array" }, { data: 123 }, { data: null }]) {
      let caught: unknown;
      try {
        validateSupportedChainsResponse(bad);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(VexError);
      expect((caught as Error).message).toBe("Expected supported chains response with data array");
    }
  });

  // --- element-shape guard: PLAIN Error on non-record element --------------
  it("throws PLAIN Error 'chain info must be an object' on a non-record element", () => {
    for (const bad of [null, 42, "str", [], true]) {
      let caught: unknown;
      try {
        validateSupportedChainsResponse({ data: [bad] });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(Error);
      expect(caught).not.toBeInstanceOf(VexError);
      expect((caught as Error).message).toBe("chain info must be an object");
    }
  });

  // --- field-level: VexError(KYBER_API_ERROR) with exact messages ----------
  it("throws VexError(KYBER_API_ERROR) for each missing required field", () => {
    const cases: Array<{ bad: Record<string, unknown>; field: string }> = [
      { bad: chain({ chainId: undefined }), field: "chain.chainId" },
      { bad: chain({ chainId: "1" }), field: "chain.chainId" },
      { bad: chain({ chainName: undefined }), field: "chain.chainName" },
      { bad: chain({ chainName: "" }), field: "chain.chainName" },
      { bad: chain({ displayName: 5 }), field: "chain.displayName" },
      { bad: chain({ state: undefined }), field: "chain.state" },
      { bad: chain({ state: "" }), field: "chain.state" },
      { bad: chain({ state: 7 }), field: "chain.state" },
    ];
    for (const { bad, field } of cases) {
      let caught: unknown;
      try {
        validateSupportedChainsResponse({ data: [bad] });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(VexError);
      expect((caught as VexError).code).toBe(ErrorCodes.KYBER_API_ERROR);
      expect((caught as Error).message).toBe(MISSING(field));
    }
  });

  // --- evaluation order: state validated FIRST (original line 17) ----------
  it("surfaces state's error first when both state and chainId are bad", () => {
    let caught: unknown;
    try {
      validateSupportedChainsResponse({ data: [chain({ state: undefined, chainId: "nope" })] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VexError);
    expect((caught as Error).message).toBe(MISSING("chain.state"));
  });

  // --- numeric semantics: asNumber accepts ±Infinity, rejects NaN ----------
  it("ACCEPTS ±Infinity for chainId (proves zNumberField, not z.number())", () => {
    const [pos] = validateSupportedChainsResponse({ data: [chain({ chainId: Infinity })] });
    expect(pos.chainId).toBe(Infinity);
    const [neg] = validateSupportedChainsResponse({ data: [chain({ chainId: -Infinity })] });
    expect(neg.chainId).toBe(-Infinity);
  });

  it("REJECTS NaN chainId with VexError(KYBER_API_ERROR)", () => {
    let caught: unknown;
    try {
      validateSupportedChainsResponse({ data: [chain({ chainId: NaN })] });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(VexError);
    expect((caught as VexError).code).toBe(ErrorCodes.KYBER_API_ERROR);
    expect((caught as Error).message).toBe(MISSING("chain.chainId"));
  });

  // --- no filtering: one bad element aborts the whole map ------------------
  it("does NOT filter: a single malformed element throws (strict map)", () => {
    expect(() =>
      validateSupportedChainsResponse({ data: [chain(), chain({ chainName: undefined })] }),
    ).toThrow(MISSING("chain.chainName"));
  });

  it("returns [] for an empty data array", () => {
    expect(validateSupportedChainsResponse({ data: [] })).toEqual([]);
  });
});
