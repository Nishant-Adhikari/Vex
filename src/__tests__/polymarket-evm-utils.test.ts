import { describe, it, expect } from "vitest";
import { validatePolySpender } from "../polymarket/evm-utils.js";
import { CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE } from "../polymarket/constants.js";
import { EchoError } from "../errors.js";

describe("validatePolySpender", () => {
  it("accepts CTF_EXCHANGE", () => {
    expect(() => validatePolySpender(CTF_EXCHANGE)).not.toThrow();
  });

  it("accepts NEG_RISK_CTF_EXCHANGE", () => {
    expect(() => validatePolySpender(NEG_RISK_CTF_EXCHANGE)).not.toThrow();
  });

  it("accepts case variations", () => {
    expect(() => validatePolySpender(CTF_EXCHANGE.toLowerCase() as `0x${string}`)).not.toThrow();
  });

  it("throws for unknown address", () => {
    expect(() => validatePolySpender("0x0000000000000000000000000000000000000001")).toThrow(EchoError);
    expect(() => validatePolySpender("0x0000000000000000000000000000000000000001")).toThrow(/not a known Polymarket contract/);
  });
});
