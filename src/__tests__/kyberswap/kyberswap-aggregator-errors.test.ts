import { describe, it, expect } from "vitest";
import { mapAggregatorError } from "@tools/kyberswap/aggregator/errors.js";
import { ErrorCodes } from "../../errors.js";

describe("mapAggregatorError", () => {
  it("maps 429 to KYBER_RATE_LIMITED (retryable)", () => {
    const err = mapAggregatorError(429, null, "Rate limited");
    expect(err.code).toBe(ErrorCodes.KYBER_RATE_LIMITED);
    expect(err.retryable).toBe(true);
  });

  it("maps code 4001 to KYBER_MALFORMED_PARAMS", () => {
    const err = mapAggregatorError(400, 4001, "Bad params");
    expect(err.code).toBe(ErrorCodes.KYBER_MALFORMED_PARAMS);
    expect(err.retryable).toBe(false);
    expect(err.externalName).toBe("4001");
  });

  it("maps code 4002 to KYBER_MALFORMED_PARAMS", () => {
    const err = mapAggregatorError(400, 4002, "Bad body");
    expect(err.code).toBe(ErrorCodes.KYBER_MALFORMED_PARAMS);
    expect(err.externalName).toBe("4002");
  });

  it("maps code 4005 to KYBER_FEE_EXCEEDS_AMOUNT", () => {
    const err = mapAggregatorError(400, 4005, "Fee exceeds input");
    expect(err.code).toBe(ErrorCodes.KYBER_FEE_EXCEEDS_AMOUNT);
  });

  it("maps code 4007 to KYBER_FEE_EXCEEDS_AMOUNT", () => {
    const err = mapAggregatorError(400, 4007, "Fee exceeds output");
    expect(err.code).toBe(ErrorCodes.KYBER_FEE_EXCEEDS_AMOUNT);
  });

  it("maps code 4008 to KYBER_ROUTE_NOT_FOUND", () => {
    const err = mapAggregatorError(400, 4008, "No route");
    expect(err.code).toBe(ErrorCodes.KYBER_ROUTE_NOT_FOUND);
    expect(err.retryable).toBe(false);
  });

  it("maps code 4009 to KYBER_AMOUNT_TOO_LARGE", () => {
    const err = mapAggregatorError(400, 4009, "Amount too large");
    expect(err.code).toBe(ErrorCodes.KYBER_AMOUNT_TOO_LARGE);
  });

  it("maps code 4010 to KYBER_ROUTE_NOT_FOUND", () => {
    const err = mapAggregatorError(400, 4010, "No pools");
    expect(err.code).toBe(ErrorCodes.KYBER_ROUTE_NOT_FOUND);
  });

  it("maps code 4011 to KYBER_TOKEN_NOT_FOUND", () => {
    const err = mapAggregatorError(400, 4011, "Token not found");
    expect(err.code).toBe(ErrorCodes.KYBER_TOKEN_NOT_FOUND);
  });

  it("maps code 4221 to KYBER_WETH_NOT_CONFIGURED", () => {
    const err = mapAggregatorError(422, 4221, "WETH not configured");
    expect(err.code).toBe(ErrorCodes.KYBER_WETH_NOT_CONFIGURED);
  });

  it("maps 5xx to KYBER_API_ERROR (retryable)", () => {
    const err = mapAggregatorError(500, null, "Server error");
    expect(err.code).toBe(ErrorCodes.KYBER_API_ERROR);
    expect(err.retryable).toBe(true);
  });

  it("includes requestId in message", () => {
    const err = mapAggregatorError(400, 4008, "No route", "req-123");
    expect(err.message).toContain("req-123");
  });

  it("sets externalName from code", () => {
    const err = mapAggregatorError(400, 4008, "No route");
    expect(err.externalName).toBe("4008");
  });

  it("handles unknown code on non-5xx", () => {
    const err = mapAggregatorError(400, 9999, "Unknown");
    expect(err.code).toBe(ErrorCodes.KYBER_API_ERROR);
    expect(err.retryable).toBe(false);
  });
});
