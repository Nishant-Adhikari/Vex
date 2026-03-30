import { describe, it, expect } from "vitest";
import { resolveChain, resolveChainWithId, requireFeature, formatUsd, formatGas } from "@commands/kyberswap/helpers.js";
import { EchoError, ErrorCodes } from "../../errors.js";

describe("resolveChain", () => {
  it("resolves slug", () => {
    expect(resolveChain("ethereum")).toBe("ethereum");
    expect(resolveChain("eth")).toBe("ethereum");
  });
});

describe("resolveChainWithId", () => {
  it("returns slug and chainId", () => {
    const result = resolveChainWithId("eth");
    expect(result.slug).toBe("ethereum");
    expect(result.chainId).toBe(1);
  });
});

describe("requireFeature", () => {
  it("does not throw for supported feature", () => {
    expect(() => requireFeature("ethereum", "aggregator")).not.toThrow();
    expect(() => requireFeature("ethereum", "zaas")).not.toThrow();
  });

  it("throws KYBER_UNSUPPORTED_CHAIN for unsupported feature", () => {
    expect(() => requireFeature("mantle", "zaas")).toThrow(EchoError);
    expect(() => requireFeature("megaeth", "zaas")).toThrow(EchoError);
  });
});

describe("formatUsd", () => {
  it("formats number", () => {
    expect(formatUsd(1234.5)).toContain("1,234.50");
  });

  it("formats string number", () => {
    expect(formatUsd("0.5")).toContain("0.50");
  });

  it("returns placeholder for NaN", () => {
    expect(formatUsd("not a number")).toBe("$—");
    expect(formatUsd(NaN)).toBe("$—");
  });
});

describe("formatGas", () => {
  it("combines gas and USD", () => {
    const result = formatGas("150000", "7.50");
    expect(result).toContain("150000");
    expect(result).toContain("7.50");
  });
});
