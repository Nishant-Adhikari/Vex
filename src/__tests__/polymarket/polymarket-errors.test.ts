import { describe, it, expect } from "vitest";
import { mapPolyTransportError, mapPolyApiError } from "@tools/polymarket/errors.js";
import { VexError, ErrorCodes } from "../../errors.js";

describe("mapPolyTransportError", () => {
  it("re-throws POLYMARKET_ errors as-is", () => {
    const err = new VexError(ErrorCodes.POLYMARKET_RATE_LIMITED, "rate limited");
    expect(() => mapPolyTransportError(err)).toThrow(err);
  });

  it("maps HTTP_TIMEOUT to POLYMARKET_TIMEOUT", () => {
    const err = new VexError(ErrorCodes.HTTP_TIMEOUT, "timed out");
    expect(() => mapPolyTransportError(err)).toThrow(expect.objectContaining({ code: ErrorCodes.POLYMARKET_TIMEOUT }));
  });

  it("maps HTTP_REQUEST_FAILED to POLYMARKET_API_ERROR", () => {
    const err = new VexError(ErrorCodes.HTTP_REQUEST_FAILED, "failed");
    expect(() => mapPolyTransportError(err)).toThrow(expect.objectContaining({ code: ErrorCodes.POLYMARKET_API_ERROR }));
  });

  it("re-throws non-VexError as-is", () => {
    const err = new Error("network");
    expect(() => mapPolyTransportError(err)).toThrow(err);
  });
});

describe("mapPolyApiError", () => {
  it("maps 429 to POLYMARKET_RATE_LIMITED (retryable)", () => {
    const err = mapPolyApiError(429, "Rate limited", "Gamma");
    expect(err.code).toBe(ErrorCodes.POLYMARKET_RATE_LIMITED);
    expect(err.retryable).toBe(true);
  });

  it("maps 401 to POLYMARKET_AUTH_FAILED with setup hint", () => {
    const err = mapPolyApiError(401, "Invalid API key", "CLOB");
    expect(err.code).toBe(ErrorCodes.POLYMARKET_AUTH_FAILED);
    expect(err.hint).toContain("setup");
  });

  it("maps 404 to POLYMARKET_MARKET_NOT_FOUND", () => {
    const err = mapPolyApiError(404, "Not found", "Gamma");
    expect(err.code).toBe(ErrorCodes.POLYMARKET_MARKET_NOT_FOUND);
  });

  it("maps 503 to POLYMARKET_API_ERROR (retryable)", () => {
    const err = mapPolyApiError(503, "Trading disabled", "CLOB");
    expect(err.code).toBe(ErrorCodes.POLYMARKET_API_ERROR);
    expect(err.retryable).toBe(true);
  });

  it("maps 5xx to POLYMARKET_API_ERROR (retryable)", () => {
    const err = mapPolyApiError(500, "Internal error", "Data");
    expect(err.code).toBe(ErrorCodes.POLYMARKET_API_ERROR);
    expect(err.retryable).toBe(true);
  });

  it("maps 400 with 'banned' to POLYMARKET_ORDER_FAILED", () => {
    const err = mapPolyApiError(400, "'0x123' address banned", "CLOB");
    expect(err.code).toBe(ErrorCodes.POLYMARKET_ORDER_FAILED);
  });

  it("maps 400 generic to POLYMARKET_API_ERROR", () => {
    const err = mapPolyApiError(400, "Invalid payload", "CLOB");
    expect(err.code).toBe(ErrorCodes.POLYMARKET_API_ERROR);
    expect(err.retryable).toBe(false);
  });
});
