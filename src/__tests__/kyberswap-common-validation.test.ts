import { describe, it, expect } from "vitest";
import { validateSupportedChainsResponse } from "../kyberswap/common/validation.js";

describe("validateSupportedChainsResponse", () => {
  it("rejects non-object", () => {
    expect(() => validateSupportedChainsResponse(null)).toThrow();
  });

  it("rejects missing data array", () => {
    expect(() => validateSupportedChainsResponse({})).toThrow();
    expect(() => validateSupportedChainsResponse({ data: "not array" })).toThrow();
  });

  it("parses valid chain info array", () => {
    const raw = {
      data: [
        { chainId: 1, chainName: "ethereum", displayName: "Ethereum", state: "active" },
        { chainId: 56, chainName: "bsc", displayName: "BSC", state: "active" },
      ],
    };
    const result = validateSupportedChainsResponse(raw);
    expect(result).toHaveLength(2);
    expect(result[0].chainId).toBe(1);
    expect(result[0].chainName).toBe("ethereum");
    expect(result[0].state).toBe("active");
  });

  it("maps unknown state to inactive", () => {
    const raw = {
      data: [{ chainId: 1, chainName: "ethereum", displayName: "Ethereum", state: "unknown_state" }],
    };
    const result = validateSupportedChainsResponse(raw);
    expect(result[0].state).toBe("inactive");
  });

  it("accepts all valid states", () => {
    for (const state of ["active", "inactive", "new"]) {
      const raw = { data: [{ chainId: 1, chainName: "eth", displayName: "E", state }] };
      const result = validateSupportedChainsResponse(raw);
      expect(result[0].state).toBe(state);
    }
  });
});
