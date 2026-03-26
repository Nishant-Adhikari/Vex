import { describe, it, expect } from "vitest";
import { validateTokenSearchResponse, validateHoneypotFotResponse } from "../tools/kyberswap/token-api/validation.js";

describe("validateTokenSearchResponse", () => {
  it("rejects non-object", () => {
    expect(() => validateTokenSearchResponse(null)).toThrow();
    expect(() => validateTokenSearchResponse("string")).toThrow();
  });

  it("rejects missing data wrapper", () => {
    expect(() => validateTokenSearchResponse({})).toThrow();
  });

  it("parses valid response with tokens", () => {
    const raw = {
      data: {
        tokens: [
          { address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", symbol: "USDC", name: "USD Coin", decimals: 6, marketCap: 30000000000 },
        ],
        pagination: { totalItems: 1 },
      },
    };
    const result = validateTokenSearchResponse(raw);
    expect(result.data.tokens).toHaveLength(1);
    expect(result.data.tokens[0].symbol).toBe("USDC");
    expect(result.data.tokens[0].decimals).toBe(6);
    expect(result.data.pagination.totalItems).toBe(1);
  });

  it("handles empty tokens array", () => {
    const raw = { data: { tokens: [], pagination: { totalItems: 0 } } };
    const result = validateTokenSearchResponse(raw);
    expect(result.data.tokens).toHaveLength(0);
  });

  it("handles optional boolean fields", () => {
    const raw = {
      data: {
        tokens: [{ address: "0x1", symbol: "T", name: "Test", decimals: 18, isVerified: true, isWhitelisted: false, isStable: true }],
        pagination: { totalItems: 1 },
      },
    };
    const result = validateTokenSearchResponse(raw);
    expect(result.data.tokens[0].isVerified).toBe(true);
    expect(result.data.tokens[0].isWhitelisted).toBe(false);
    expect(result.data.tokens[0].isStable).toBe(true);
  });
});

describe("validateHoneypotFotResponse", () => {
  it("rejects non-object", () => {
    expect(() => validateHoneypotFotResponse(null)).toThrow();
  });

  it("parses valid response", () => {
    const result = validateHoneypotFotResponse({ isHoneypot: true, isFOT: false, tax: 5 });
    expect(result.isHoneypot).toBe(true);
    expect(result.isFOT).toBe(false);
    expect(result.tax).toBe(5);
  });

  it("defaults booleans to false when missing", () => {
    const result = validateHoneypotFotResponse({});
    expect(result.isHoneypot).toBe(false);
    expect(result.isFOT).toBe(false);
    expect(result.tax).toBe(0);
  });
});
