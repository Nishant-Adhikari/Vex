import { describe, it, expect } from "vitest";
import { mapZaasError } from "../tools/kyberswap/zaas/errors.js";
import { ErrorCodes } from "../errors.js";

describe("mapZaasError", () => {
  it("maps 429 to KYBER_RATE_LIMITED with rate limit hint", () => {
    const err = mapZaasError(429, null, "Too many requests");
    expect(err.code).toBe(ErrorCodes.KYBER_RATE_LIMITED);
    expect(err.retryable).toBe(true);
    expect(err.hint).toContain("10 req/10s");
  });

  it("maps 400 to KYBER_MALFORMED_PARAMS", () => {
    const err = mapZaasError(400, 3, "Validation error");
    expect(err.code).toBe(ErrorCodes.KYBER_MALFORMED_PARAMS);
    expect(err.retryable).toBe(false);
    expect(err.externalName).toBe("3");
  });

  it("maps 404 to KYBER_ZAP_ROUTE_NOT_FOUND", () => {
    const err = mapZaasError(404, 5, "Cannot swap tokens");
    expect(err.code).toBe(ErrorCodes.KYBER_ZAP_ROUTE_NOT_FOUND);
    expect(err.retryable).toBe(false);
  });

  it("maps 5xx to KYBER_API_ERROR (retryable)", () => {
    const err = mapZaasError(502, null, "Bad gateway");
    expect(err.code).toBe(ErrorCodes.KYBER_API_ERROR);
    expect(err.retryable).toBe(true);
  });

  it("maps other status to KYBER_API_ERROR (not retryable)", () => {
    const err = mapZaasError(403, null, "Forbidden");
    expect(err.code).toBe(ErrorCodes.KYBER_API_ERROR);
    expect(err.retryable).toBe(false);
  });
});
