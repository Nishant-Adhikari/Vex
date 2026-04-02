import { describe, it, expect } from "vitest";
import { validateKyberSpender, verifyRouterAddress, extractMintedNftId } from "@tools/kyberswap/evm-utils.js";
import {
  META_AGGREGATION_ROUTER_V2,
  DSLO_PROTOCOL,
  KS_ZAP_ROUTER_POSITION,
  KS_ZAP_ROUTER_PERMIT,
} from "@tools/kyberswap/constants.js";
import { EchoError, ErrorCodes } from "../../errors.js";

describe("validateKyberSpender", () => {
  it("accepts MetaAggregationRouterV2", () => {
    expect(() => validateKyberSpender(META_AGGREGATION_ROUTER_V2)).not.toThrow();
  });

  it("accepts DSLOProtocol", () => {
    expect(() => validateKyberSpender(DSLO_PROTOCOL)).not.toThrow();
  });

  it("accepts KSZapRouterPosition", () => {
    expect(() => validateKyberSpender(KS_ZAP_ROUTER_POSITION)).not.toThrow();
  });

  it("accepts KSZapRouterPermit", () => {
    expect(() => validateKyberSpender(KS_ZAP_ROUTER_PERMIT)).not.toThrow();
  });

  it("accepts case variations", () => {
    expect(() => validateKyberSpender(META_AGGREGATION_ROUTER_V2.toLowerCase() as `0x${string}`)).not.toThrow();
    expect(() => validateKyberSpender(META_AGGREGATION_ROUTER_V2.toUpperCase().replace("0X", "0x") as `0x${string}`)).not.toThrow();
  });

  it("throws INVALID_SPENDER for unknown address", () => {
    expect(() => validateKyberSpender("0x0000000000000000000000000000000000000001")).toThrow(EchoError);
    expect(() => validateKyberSpender("0x0000000000000000000000000000000000000001")).toThrow(/not a known KyberSwap contract/);
  });
});

describe("verifyRouterAddress", () => {
  it("passes when addresses match", () => {
    expect(() => verifyRouterAddress(META_AGGREGATION_ROUTER_V2, META_AGGREGATION_ROUTER_V2)).not.toThrow();
  });

  it("passes with different casing", () => {
    const lower = META_AGGREGATION_ROUTER_V2.toLowerCase() as `0x${string}`;
    expect(() => verifyRouterAddress(lower, META_AGGREGATION_ROUTER_V2)).not.toThrow();
  });

  it("throws KYBER_API_ERROR when addresses differ", () => {
    expect(() => verifyRouterAddress(
      "0x0000000000000000000000000000000000000001",
      META_AGGREGATION_ROUTER_V2,
    )).toThrow(EchoError);
  });

  it("includes 'Do not approve' in hint", () => {
    try {
      verifyRouterAddress("0x0000000000000000000000000000000000000001", META_AGGREGATION_ROUTER_V2);
    } catch (err) {
      expect((err as EchoError).code).toBe(ErrorCodes.KYBER_API_ERROR);
      expect((err as EchoError).hint).toContain("Do not approve");
    }
  });
});

// ── extractMintedNftId ──────────────────────────────────────────

describe("extractMintedNftId", () => {
  const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
  const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
  const WALLET = "0x18b467Cb28FC07Ca6E17A964b3319051B3072B79";
  const WALLET_PADDED = "0x00000000000000000000000018b467cb28fc07ca6e17a964b3319051b3072b79";

  it("extracts tokenId from ERC-721 mint to recipient", () => {
    const logs = [
      // ERC-20 Transfer (3 topics — should be skipped)
      { address: "0xtoken", topics: [TRANSFER_TOPIC, ZERO, WALLET_PADDED], data: "0x00000000000000000000000000000000000000000000000000000000000f4240" },
      // ERC-721 Transfer mint (4 topics — this is the one)
      { address: "0xc36442b4a4522e871399cd717abdd847ab11fe88", topics: [TRANSFER_TOPIC, ZERO, WALLET_PADDED, "0x00000000000000000000000000000000000000000000000000000000002bf5ff"], data: "0x" },
    ];
    const result = extractMintedNftId(logs, WALLET);
    expect(result).toBe("2881023"); // 0x2bf5ff
  });

  it("returns undefined when no ERC-721 mint found", () => {
    const logs = [
      // Only ERC-20 transfers (3 topics)
      { address: "0xtoken", topics: [TRANSFER_TOPIC, ZERO, WALLET_PADDED], data: "0x01" },
    ];
    expect(extractMintedNftId(logs, WALLET)).toBeUndefined();
  });

  it("ignores mints to different recipient", () => {
    const OTHER_WALLET = "0x0000000000000000000000001111111111111111111111111111111111111111";
    const logs = [
      { address: "0xnft", topics: [TRANSFER_TOPIC, ZERO, OTHER_WALLET, "0x0000000000000000000000000000000000000000000000000000000000000042"], data: "0x" },
    ];
    expect(extractMintedNftId(logs, WALLET)).toBeUndefined();
  });

  it("ignores non-mint transfers (from != 0x0)", () => {
    const SENDER = "0x0000000000000000000000002222222222222222222222222222222222222222";
    const logs = [
      { address: "0xnft", topics: [TRANSFER_TOPIC, SENDER, WALLET_PADDED, "0x0000000000000000000000000000000000000000000000000000000000000042"], data: "0x" },
    ];
    expect(extractMintedNftId(logs, WALLET)).toBeUndefined();
  });

  it("handles empty logs", () => {
    expect(extractMintedNftId([], WALLET)).toBeUndefined();
  });

  it("extracts real tokenId 2879807 from April 2 retest", () => {
    // Real data: tokenId 2879807 = 0x2BF43F
    const logs = [
      { address: "0xc36442b4a4522e871399cd717abdd847ab11fe88", topics: [TRANSFER_TOPIC, ZERO, WALLET_PADDED, "0x00000000000000000000000000000000000000000000000000000000002bf43f"], data: "0x" },
    ];
    expect(extractMintedNftId(logs, WALLET)).toBe("2880575"); // 0x2BF43F
  });
});
