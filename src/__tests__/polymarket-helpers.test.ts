import { describe, it, expect, afterEach } from "vitest";
import { parseOutcomePrices, parseOutcomes, parseClobTokenIds, formatUsd, formatProbability, requirePolyAuth } from "../commands/polymarket/helpers.js";
import { EchoError } from "../errors.js";

describe("parseOutcomePrices", () => {
  it("parses valid JSON", () => {
    expect(parseOutcomePrices('["0.65","0.35"]')).toEqual({ yes: 0.65, no: 0.35 });
  });
  it("returns zeros for null", () => {
    expect(parseOutcomePrices(null)).toEqual({ yes: 0, no: 0 });
  });
  it("returns zeros for invalid JSON", () => {
    expect(parseOutcomePrices("not json")).toEqual({ yes: 0, no: 0 });
  });
});

describe("parseOutcomes", () => {
  it("parses valid JSON", () => {
    expect(parseOutcomes('["Yes","No"]')).toEqual(["Yes", "No"]);
  });
  it("returns defaults for null", () => {
    expect(parseOutcomes(null)).toEqual(["Yes", "No"]);
  });
});

describe("parseClobTokenIds", () => {
  it("parses valid JSON", () => {
    const result = parseClobTokenIds('["token-yes-123","token-no-456"]');
    expect(result.yes).toBe("token-yes-123");
    expect(result.no).toBe("token-no-456");
  });
  it("returns empty for null", () => {
    expect(parseClobTokenIds(null)).toEqual({ yes: "", no: "" });
  });
});

describe("formatUsd", () => {
  it("formats number", () => {
    expect(formatUsd(1234.5)).toContain("1,234.50");
  });
  it("returns placeholder for NaN", () => {
    expect(formatUsd(NaN)).toBe("$—");
  });
  it("returns placeholder for null", () => {
    expect(formatUsd(null)).toBe("$—");
  });
});

describe("formatProbability", () => {
  it("formats price as percentage", () => {
    expect(formatProbability(0.65)).toBe("65.0%");
  });
  it("returns placeholder for null", () => {
    expect(formatProbability(null)).toBe("—%");
  });
});

describe("requirePolyAuth", () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it("throws when not configured", () => {
    delete process.env.POLYMARKET_API_KEY;
    delete process.env.POLYMARKET_API_SECRET;
    delete process.env.POLYMARKET_PASSPHRASE;
    expect(() => requirePolyAuth()).toThrow(EchoError);
  });

  it("does not throw when configured", () => {
    process.env.POLYMARKET_API_KEY = "k";
    process.env.POLYMARKET_API_SECRET = "s";
    process.env.POLYMARKET_PASSPHRASE = "p";
    expect(() => requirePolyAuth()).not.toThrow();
  });
});
