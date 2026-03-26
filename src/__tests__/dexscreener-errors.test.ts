import { describe, expect, it } from "vitest";
import { mapDexScreenerError, mapTransportError } from "../tools/dexscreener/errors.js";
import { EchoError, ErrorCodes } from "../errors.js";

describe("mapDexScreenerError", () => {
  it("maps 429 to DEXSCREENER_RATE_LIMITED", () => {
    const error = mapDexScreenerError(429);
    expect(error.code).toBe(ErrorCodes.DEXSCREENER_RATE_LIMITED);
  });

  it("marks 429 as retryable", () => {
    const error = mapDexScreenerError(429);
    expect(error.retryable).toBe(true);
  });

  it("maps 404 to DEXSCREENER_NOT_FOUND", () => {
    const error = mapDexScreenerError(404);
    expect(error.code).toBe(ErrorCodes.DEXSCREENER_NOT_FOUND);
  });

  it("maps 500 to DEXSCREENER_API_ERROR", () => {
    const error = mapDexScreenerError(500);
    expect(error.code).toBe(ErrorCodes.DEXSCREENER_API_ERROR);
  });

  it("marks 500 as retryable", () => {
    const error = mapDexScreenerError(500);
    expect(error.retryable).toBe(true);
  });

  it("maps 502 to DEXSCREENER_API_ERROR (server error family)", () => {
    const error = mapDexScreenerError(502);
    expect(error.code).toBe(ErrorCodes.DEXSCREENER_API_ERROR);
    expect(error.retryable).toBe(true);
  });

  it("maps 400 to DEXSCREENER_API_ERROR (generic)", () => {
    const error = mapDexScreenerError(400);
    expect(error.code).toBe(ErrorCodes.DEXSCREENER_API_ERROR);
  });

  it("includes custom message when provided", () => {
    const error = mapDexScreenerError(429, "Too many requests");
    expect(error.message).toBe("Too many requests");
  });

  it("uses default message when none provided", () => {
    const error = mapDexScreenerError(500);
    expect(error.message).toContain("HTTP 500");
  });
});

describe("mapTransportError", () => {
  it("re-throws DEXSCREENER_* errors as-is", () => {
    const original = new EchoError(ErrorCodes.DEXSCREENER_RATE_LIMITED, "rate limited");
    expect(() => mapTransportError(original)).toThrow(original);
  });

  it("maps HTTP_TIMEOUT to DEXSCREENER_TIMEOUT", () => {
    const original = new EchoError(ErrorCodes.HTTP_TIMEOUT, "timed out");
    try {
      mapTransportError(original);
    } catch (err) {
      expect(err).toMatchObject({ code: ErrorCodes.DEXSCREENER_TIMEOUT });
      return;
    }
    expect.fail("should have thrown");
  });

  it("maps HTTP_REQUEST_FAILED to DEXSCREENER_API_ERROR", () => {
    const original = new EchoError(ErrorCodes.HTTP_REQUEST_FAILED, "connection refused");
    try {
      mapTransportError(original);
    } catch (err) {
      expect(err).toMatchObject({ code: ErrorCodes.DEXSCREENER_API_ERROR });
      return;
    }
    expect.fail("should have thrown");
  });

  it("re-throws unknown errors", () => {
    const original = new Error("something else");
    expect(() => mapTransportError(original)).toThrow(original);
  });
});
