import { describe, it, expect } from "vitest";
import {
  GAMMA_BASE_URL, CLOB_BASE_URL, DATA_API_BASE_URL, BRIDGE_BASE_URL, RELAYER_BASE_URL,
  CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, CONDITIONAL_TOKENS, USDC_E_ADDRESS,
  POLY_KNOWN_SPENDERS,
  GAMMA_TIMEOUT_MS, CLOB_TIMEOUT_MS, DATA_API_TIMEOUT_MS, BRIDGE_TIMEOUT_MS, RELAYER_TIMEOUT_MS,
  POLYGON_CHAIN_ID,
} from "@tools/polymarket/constants.js";

const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/;

describe("contract addresses", () => {
  for (const [name, addr] of Object.entries({ CTF_EXCHANGE, NEG_RISK_CTF_EXCHANGE, CONDITIONAL_TOKENS, USDC_E_ADDRESS })) {
    it(`${name} is valid hex address`, () => { expect(addr).toMatch(HEX_ADDR); });
  }
});

describe("POLY_KNOWN_SPENDERS", () => {
  it("has 2 entries", () => { expect(POLY_KNOWN_SPENDERS.size).toBe(2); });
  it("contains CTF_EXCHANGE", () => { expect(POLY_KNOWN_SPENDERS.has(CTF_EXCHANGE.toLowerCase())).toBe(true); });
  it("contains NEG_RISK_CTF_EXCHANGE", () => { expect(POLY_KNOWN_SPENDERS.has(NEG_RISK_CTF_EXCHANGE.toLowerCase())).toBe(true); });
});

describe("base URLs", () => {
  for (const url of [GAMMA_BASE_URL, CLOB_BASE_URL, DATA_API_BASE_URL, BRIDGE_BASE_URL, RELAYER_BASE_URL]) {
    it(`${url} is HTTPS`, () => { expect(url).toMatch(/^https:\/\//); });
  }
});

describe("timeouts", () => {
  for (const t of [GAMMA_TIMEOUT_MS, CLOB_TIMEOUT_MS, DATA_API_TIMEOUT_MS, BRIDGE_TIMEOUT_MS, RELAYER_TIMEOUT_MS]) {
    it(`${t}ms is positive`, () => { expect(t).toBeGreaterThan(0); });
  }
});

describe("chain", () => {
  it("POLYGON_CHAIN_ID is 137", () => { expect(POLYGON_CHAIN_ID).toBe(137); });
});
