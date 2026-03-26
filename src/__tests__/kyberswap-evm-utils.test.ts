import { describe, it, expect } from "vitest";
import { validateKyberSpender, verifyRouterAddress } from "../tools/kyberswap/evm-utils.js";
import {
  META_AGGREGATION_ROUTER_V2,
  DSLO_PROTOCOL,
  KS_ZAP_ROUTER_POSITION,
  KS_ZAP_ROUTER_PERMIT,
} from "../tools/kyberswap/constants.js";
import { EchoError, ErrorCodes } from "../errors.js";

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
