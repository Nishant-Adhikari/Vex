/**
 * extractCauseCode — D-EXTRACT contract (docs/error-diagnostics-plan.md §3.1).
 *
 * Pins: errno found at every depth 1-5, AggregateError fallback, cycle
 * safety, numeric codes ignored, message text never returned, non-Error
 * input handled, depth bound enforced.
 */

import { describe, it, expect } from "vitest";
import { extractCauseCode } from "../../lib/error-cause.js";

/** Build an Error with an own `code` property (errno style). */
function errnoError(code: unknown, message = "low-level failure"): Error {
  const e = new Error(message);
  Object.assign(e, { code });
  return e;
}

/** Wrap `inner` in `depth` plain Error layers via `.cause`. */
function nest(inner: Error, depth: number): Error {
  let current = inner;
  for (let i = 0; i < depth; i++) {
    current = new Error(`wrapper-${i}`, { cause: current });
  }
  return current;
}

describe("extractCauseCode", () => {
  it("reads an errno code on the top-level error (depth 0)", () => {
    expect(extractCauseCode(errnoError("ENOTFOUND"))).toBe("ENOTFOUND");
  });

  it.each([1, 2, 3, 4, 5])("finds the errno at cause depth %d", (depth) => {
    const err = nest(errnoError("UNABLE_TO_VERIFY_LEAF_SIGNATURE"), depth);
    expect(extractCauseCode(err)).toBe("UNABLE_TO_VERIFY_LEAF_SIGNATURE");
  });

  it("returns null beyond the depth bound (errno at depth 7)", () => {
    const err = nest(errnoError("ECONNREFUSED"), 7);
    expect(extractCauseCode(err)).toBeNull();
  });

  it("falls back to AggregateError.errors[0]", () => {
    const agg = new AggregateError(
      [errnoError("ECONNREFUSED"), errnoError("ETIMEDOUT")],
      "connect failed to every address",
    );
    const err = new Error("fetch failed", { cause: agg });
    expect(extractCauseCode(err)).toBe("ECONNREFUSED");
  });

  it("terminates on a cause cycle and returns null when no code exists", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    Object.assign(a, { cause: b });
    expect(extractCauseCode(a)).toBeNull();
  });

  it("still finds a code on a cycle member", () => {
    const a = errnoError("ECONNRESET");
    const b = new Error("b", { cause: a });
    Object.assign(a, { cause: b });
    expect(extractCauseCode(b)).toBe("ECONNRESET");
  });

  it("ignores numeric codes (provider error dictionary)", () => {
    expect(extractCauseCode(errnoError(429))).toBeNull();
  });

  it("keeps walking past a numeric code to a deeper errno string", () => {
    const inner = errnoError("EAI_AGAIN");
    const outer = errnoError(502, "gateway");
    Object.assign(outer, { cause: inner });
    expect(extractCauseCode(outer)).toBe("EAI_AGAIN");
  });

  it("never returns message text — even when the message looks like prose", () => {
    const err = new Error(
      "getaddrinfo failed: secret-user-data@example.com could not resolve",
    );
    expect(extractCauseCode(err)).toBeNull();
  });

  it("rejects non-errno-shaped code strings (prose, lowercase, too short)", () => {
    expect(extractCauseCode(errnoError("Bad thing happened"))).toBeNull();
    expect(extractCauseCode(errnoError("econnreset"))).toBeNull();
    expect(extractCauseCode(errnoError("EX"))).toBeNull();
  });

  it("handles non-Error input: plain records walk, primitives return null", () => {
    expect(extractCauseCode({ code: "UND_ERR_CONNECT_TIMEOUT" })).toBe(
      "UND_ERR_CONNECT_TIMEOUT",
    );
    expect(
      extractCauseCode({ cause: { code: "DEPTH_ZERO_SELF_SIGNED_CERT" } }),
    ).toBe("DEPTH_ZERO_SELF_SIGNED_CERT");
    expect(extractCauseCode("ENOTFOUND")).toBeNull();
    expect(extractCauseCode(null)).toBeNull();
    expect(extractCauseCode(undefined)).toBeNull();
    expect(extractCauseCode(42)).toBeNull();
  });

  it("reads an inherited code property (prototype-carried errno)", () => {
    class CodedError extends Error {
      get code(): string {
        return "CERT_HAS_EXPIRED";
      }
    }
    expect(extractCauseCode(new CodedError("tls"))).toBe("CERT_HAS_EXPIRED");
  });
});
