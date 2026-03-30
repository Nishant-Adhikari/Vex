import { describe, it, expect } from "vitest";
import { mapKyberTransportError } from "@tools/kyberswap/errors.js";
import { EchoError, ErrorCodes } from "../../errors.js";

describe("mapKyberTransportError", () => {
  it("re-throws EchoError with KYBER_ prefix as-is", () => {
    const err = new EchoError(ErrorCodes.KYBER_RATE_LIMITED, "Rate limited");
    expect(() => mapKyberTransportError(err)).toThrow(err);
  });

  it("maps HTTP_TIMEOUT to KYBER_TIMEOUT", () => {
    const err = new EchoError(ErrorCodes.HTTP_TIMEOUT, "Timed out", "hint");
    expect(() => mapKyberTransportError(err)).toThrow(
      expect.objectContaining({ code: ErrorCodes.KYBER_TIMEOUT }),
    );
  });

  it("maps HTTP_REQUEST_FAILED to KYBER_API_ERROR", () => {
    const err = new EchoError(ErrorCodes.HTTP_REQUEST_FAILED, "Failed", "hint");
    expect(() => mapKyberTransportError(err)).toThrow(
      expect.objectContaining({ code: ErrorCodes.KYBER_API_ERROR }),
    );
  });

  it("re-throws non-EchoError as-is", () => {
    const err = new Error("network error");
    expect(() => mapKyberTransportError(err)).toThrow(err);
  });

  it("re-throws EchoError with non-KYBER/non-HTTP code", () => {
    const err = new EchoError("SOME_OTHER_CODE", "other");
    expect(() => mapKyberTransportError(err)).toThrow(err);
  });
});
