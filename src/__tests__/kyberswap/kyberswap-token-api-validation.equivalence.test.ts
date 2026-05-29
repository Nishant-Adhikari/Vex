/**
 * Behavior-equivalence battery for the Zod conversion of the KyberSwap Token
 * API validators (codex-002 Phase 2). Expected outputs are derived from the
 * ORIGINAL hand-written logic:
 *
 *   - root-type mismatch → plain `Error` with the original message;
 *   - token field failure → `VexError(KYBER_TOKEN_SEARCH_FAILED)` with the
 *     original `Invalid KyberSwap Token API response: missing <field>` message;
 *   - `decimals`/`marketCap` accept ±Infinity, reject NaN (NOT z.number());
 *   - `tax` accepts NaN (typeof NaN === "number");
 *   - element-wise token mapping, computed `totalItems` default, lenient
 *     boolean/optional-number defaults.
 */

import { describe, it, expect } from "vitest";
import {
  validateTokenSearchResponse,
  validateHoneypotFotResponse,
} from "@tools/kyberswap/token-api/validation.js";
import { VexError, ErrorCodes } from "../../errors.js";

const ADDR = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";

describe("validateTokenSearchResponse — root type", () => {
  it("throws a plain Error (not VexError) on non-record root, with the original message", () => {
    for (const bad of [null, undefined, "string", 42, [], true]) {
      expect(() => validateTokenSearchResponse(bad)).toThrow(
        "Expected Token API search response with data wrapper",
      );
      try {
        validateTokenSearchResponse(bad);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).not.toBeInstanceOf(VexError);
      }
    }
  });

  it("throws plain Error when data wrapper is missing or non-record", () => {
    for (const bad of [{}, { data: null }, { data: "x" }, { data: [] }, { data: 1 }]) {
      expect(() => validateTokenSearchResponse(bad)).toThrow(
        "Expected Token API search response with data wrapper",
      );
    }
  });
});

describe("validateTokenSearchResponse — happy + defaults", () => {
  it("parses a valid token and preserves all fields", () => {
    const result = validateTokenSearchResponse({
      data: {
        tokens: [
          {
            address: ADDR,
            symbol: "USDC",
            name: "USD Coin",
            decimals: 6,
            marketCap: 30_000_000_000,
            isVerified: true,
            isWhitelisted: false,
            isStable: true,
          },
        ],
        pagination: { totalItems: 1 },
      },
    });
    expect(result.data.tokens).toHaveLength(1);
    const t = result.data.tokens[0];
    expect(t.address).toBe(ADDR);
    expect(t.symbol).toBe("USDC");
    expect(t.name).toBe("USD Coin");
    expect(t.decimals).toBe(6);
    expect(t.marketCap).toBe(30_000_000_000);
    expect(t.isVerified).toBe(true);
    expect(t.isWhitelisted).toBe(false);
    expect(t.isStable).toBe(true);
  });

  it("non-array tokens collapses to [] and totalItems falls back to tokens.length (0)", () => {
    const result = validateTokenSearchResponse({ data: { tokens: "nope" } });
    expect(result.data.tokens).toEqual([]);
    expect(result.data.pagination.totalItems).toBe(0);
  });

  it("missing tokens key → [] and totalItems 0", () => {
    const result = validateTokenSearchResponse({ data: {} });
    expect(result.data.tokens).toEqual([]);
    expect(result.data.pagination.totalItems).toBe(0);
  });

  it("totalItems falls back to tokens.length when pagination.totalItems is not a number", () => {
    const mkTok = (symbol: string) => ({ address: ADDR, symbol, name: symbol, decimals: 18 });
    // non-record pagination → {} → totalItems = tokens.length
    let result = validateTokenSearchResponse({
      data: { tokens: [mkTok("A"), mkTok("B")], pagination: "bad" },
    });
    expect(result.data.pagination.totalItems).toBe(2);
    // pagination present but totalItems non-number → tokens.length
    result = validateTokenSearchResponse({
      data: { tokens: [mkTok("A")], pagination: { totalItems: "5" } },
    });
    expect(result.data.pagination.totalItems).toBe(1);
    // explicit numeric totalItems is honored even if it disagrees with length
    result = validateTokenSearchResponse({
      data: { tokens: [mkTok("A")], pagination: { totalItems: 99 } },
    });
    expect(result.data.pagination.totalItems).toBe(99);
  });

  it("optional fields default to undefined when missing or wrong-typed", () => {
    const result = validateTokenSearchResponse({
      data: {
        tokens: [
          {
            address: ADDR,
            symbol: "T",
            name: "Test",
            decimals: 18,
            // marketCap missing; booleans wrong-typed
            isVerified: "yes",
            isWhitelisted: 1,
            isStable: null,
          },
        ],
        pagination: { totalItems: 1 },
      },
    });
    const t = result.data.tokens[0];
    expect(t.marketCap).toBeUndefined();
    expect(t.isVerified).toBeUndefined();
    expect(t.isWhitelisted).toBeUndefined();
    expect(t.isStable).toBeUndefined();
  });

  it("strips unknown keys on the token (Zod default)", () => {
    const result = validateTokenSearchResponse({
      data: {
        tokens: [{ address: ADDR, symbol: "T", name: "Test", decimals: 18, extra: "drop-me" }],
        pagination: { totalItems: 1 },
      },
    });
    expect(result.data.tokens[0]).not.toHaveProperty("extra");
  });
});

describe("validateTokenSearchResponse — strict token fields (VexError)", () => {
  const base = { address: ADDR, symbol: "T", name: "Test", decimals: 18 };

  const cases: Array<{ name: string; patch: Record<string, unknown>; field: string }> = [
    { name: "missing address", patch: { address: undefined }, field: "token.address" },
    { name: "empty address", patch: { address: "" }, field: "token.address" },
    { name: "non-string symbol", patch: { symbol: 123 }, field: "token.symbol" },
    { name: "missing name", patch: { name: undefined }, field: "token.name" },
    { name: "non-number decimals", patch: { decimals: "18" }, field: "token.decimals" },
  ];

  for (const c of cases) {
    it(`throws VexError(KYBER_TOKEN_SEARCH_FAILED) for ${c.name}`, () => {
      const raw = { data: { tokens: [{ ...base, ...c.patch }], pagination: { totalItems: 1 } } };
      try {
        validateTokenSearchResponse(raw);
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(VexError);
        if (e instanceof VexError) {
          expect(e.code).toBe(ErrorCodes.KYBER_TOKEN_SEARCH_FAILED);
          expect(e.message).toBe(`Invalid KyberSwap Token API response: missing ${c.field}`);
        }
      }
    });
  }

  it("non-record token element throws a plain Error 'token must be an object' (NOT VexError)", () => {
    for (const badEl of [null, "str", 5, [], true]) {
      const raw = { data: { tokens: [badEl], pagination: { totalItems: 1 } } };
      try {
        validateTokenSearchResponse(raw);
        throw new Error("expected throw");
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).not.toBeInstanceOf(VexError);
        expect((e as Error).message).toBe("token must be an object");
      }
    }
  });
});

describe("validateTokenSearchResponse — decimals number semantics (asNumber, NOT z.number())", () => {
  const mk = (decimals: unknown) => ({
    data: { tokens: [{ address: ADDR, symbol: "T", name: "Test", decimals }], pagination: {} },
  });

  it("ACCEPTS Infinity for decimals (z.number() would wrongly reject)", () => {
    const result = validateTokenSearchResponse(mk(Infinity));
    expect(result.data.tokens[0].decimals).toBe(Infinity);
  });

  it("ACCEPTS -Infinity for decimals", () => {
    const result = validateTokenSearchResponse(mk(-Infinity));
    expect(result.data.tokens[0].decimals).toBe(-Infinity);
  });

  it("REJECTS NaN for decimals (VexError missing token.decimals)", () => {
    try {
      validateTokenSearchResponse(mk(NaN));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VexError);
      expect((e as VexError).message).toBe(
        "Invalid KyberSwap Token API response: missing token.decimals",
      );
    }
  });

  it("ACCEPTS Infinity for marketCap (asOptionalNumber, keeps the value)", () => {
    const result = validateTokenSearchResponse({
      data: {
        tokens: [{ address: ADDR, symbol: "T", name: "Test", decimals: 18, marketCap: Infinity }],
        pagination: {},
      },
    });
    expect(result.data.tokens[0].marketCap).toBe(Infinity);
  });

  it("marketCap NaN → undefined (asOptionalNumber rejects NaN, never throws)", () => {
    const result = validateTokenSearchResponse({
      data: {
        tokens: [{ address: ADDR, symbol: "T", name: "Test", decimals: 18, marketCap: NaN }],
        pagination: {},
      },
    });
    expect(result.data.tokens[0].marketCap).toBeUndefined();
  });
});

describe("validateHoneypotFotResponse — lenient defaults + plain-Error root", () => {
  it("throws a plain Error (not VexError) on non-record root", () => {
    for (const bad of [null, undefined, "x", 1, [], true]) {
      expect(() => validateHoneypotFotResponse(bad)).toThrow(
        "Expected honeypot/FOT response object",
      );
      try {
        validateHoneypotFotResponse(bad);
      } catch (e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).not.toBeInstanceOf(VexError);
      }
    }
  });

  it("parses a fully valid response", () => {
    const result = validateHoneypotFotResponse({ isHoneypot: true, isFOT: false, tax: 5 });
    expect(result).toEqual({ isHoneypot: true, isFOT: false, tax: 5 });
  });

  it("defaults all fields when missing (booleans → false, tax → 0)", () => {
    expect(validateHoneypotFotResponse({})).toEqual({ isHoneypot: false, isFOT: false, tax: 0 });
  });

  it("wrong-typed booleans default to false; wrong-typed tax defaults to 0", () => {
    const result = validateHoneypotFotResponse({ isHoneypot: "yes", isFOT: 1, tax: "5" });
    expect(result).toEqual({ isHoneypot: false, isFOT: false, tax: 0 });
  });

  it("tax ACCEPTS NaN (typeof NaN === 'number'), matching the original guard", () => {
    const result = validateHoneypotFotResponse({ tax: NaN });
    expect(Number.isNaN(result.tax)).toBe(true);
  });

  it("tax ACCEPTS Infinity", () => {
    expect(validateHoneypotFotResponse({ tax: Infinity }).tax).toBe(Infinity);
  });

  it("strips unknown keys (Zod default)", () => {
    const result = validateHoneypotFotResponse({ isHoneypot: true, extra: "drop" });
    expect(result).not.toHaveProperty("extra");
  });
});
