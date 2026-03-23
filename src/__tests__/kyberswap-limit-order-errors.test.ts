import { describe, it, expect } from "vitest";
import { mapLimitOrderError } from "../kyberswap/limit-order/errors.js";
import { ErrorCodes } from "../errors.js";

describe("mapLimitOrderError", () => {
  it("maps 429 to KYBER_RATE_LIMITED (retryable)", () => {
    const err = mapLimitOrderError(429, "Rate limited");
    expect(err.code).toBe(ErrorCodes.KYBER_RATE_LIMITED);
    expect(err.retryable).toBe(true);
  });

  it("maps 404 to KYBER_LO_ORDER_NOT_FOUND", () => {
    const err = mapLimitOrderError(404, "Order not found");
    expect(err.code).toBe(ErrorCodes.KYBER_LO_ORDER_NOT_FOUND);
    expect(err.retryable).toBe(false);
  });

  it("maps 400 with 'signature' to KYBER_LO_SIGNATURE_INVALID", () => {
    const err = mapLimitOrderError(400, "Invalid signature for order");
    expect(err.code).toBe(ErrorCodes.KYBER_LO_SIGNATURE_INVALID);
  });

  it("maps 400 with 'allowance' to KYBER_LO_INSUFFICIENT_ALLOWANCE", () => {
    const err = mapLimitOrderError(400, "Insufficient allowance");
    expect(err.code).toBe(ErrorCodes.KYBER_LO_INSUFFICIENT_ALLOWANCE);
  });

  it("maps 400 with 'balance' to KYBER_LO_INSUFFICIENT_ALLOWANCE", () => {
    const err = mapLimitOrderError(400, "Insufficient balance for order");
    expect(err.code).toBe(ErrorCodes.KYBER_LO_INSUFFICIENT_ALLOWANCE);
  });

  it("maps 400 generic to KYBER_MALFORMED_PARAMS", () => {
    const err = mapLimitOrderError(400, "Invalid request");
    expect(err.code).toBe(ErrorCodes.KYBER_MALFORMED_PARAMS);
  });

  it("maps 5xx to KYBER_API_ERROR (retryable)", () => {
    const err = mapLimitOrderError(500, "Internal error");
    expect(err.code).toBe(ErrorCodes.KYBER_API_ERROR);
    expect(err.retryable).toBe(true);
  });

  it("maps other status to KYBER_API_ERROR (not retryable)", () => {
    const err = mapLimitOrderError(403, "Forbidden");
    expect(err.code).toBe(ErrorCodes.KYBER_API_ERROR);
    expect(err.retryable).toBe(false);
  });
});
