import { describe, it, expect } from "vitest";
import { classifyMissionRunError } from "../../../../vex-agent/engine/core/runner/mission-error-classifier.js";

/** Build an Error with arbitrary extra fields (status/code/retryable/name). */
function err(
  message: string,
  extra: Record<string, unknown> = {},
): Error {
  const e = new Error(message);
  Object.assign(e, extra);
  return e;
}

describe("classifyMissionRunError", () => {
  describe("transient", () => {
    it("429 via message", () => {
      expect(classifyMissionRunError(err("Provider returned 429 rate limited"))).toBe("transient");
    });
    it("5xx via message (502/503/504/500)", () => {
      for (const s of [500, 502, 503, 504]) {
        expect(classifyMissionRunError(err(`upstream returned ${s}`))).toBe("transient");
      }
    });
    it("status field 429/503", () => {
      expect(classifyMissionRunError(err("x", { status: 429 }))).toBe("transient");
      expect(classifyMissionRunError(err("x", { statusCode: 503 }))).toBe("transient");
    });
    it("socket/network node codes", () => {
      for (const code of ["ETIMEDOUT", "ECONNRESET", "ECONNREFUSED", "EAI_AGAIN", "EPIPE"]) {
        expect(classifyMissionRunError(err("net", { code }))).toBe("transient");
      }
    });
    it("HTTP_TIMEOUT vex code (even when surfaced as AbortError)", () => {
      expect(classifyMissionRunError(err("timed out", { code: "HTTP_TIMEOUT", name: "AbortError" }))).toBe("transient");
    });
    it("explicit retryable marker from a mapper", () => {
      expect(classifyMissionRunError(err("khalani 5xx", { retryable: true }))).toBe("transient");
    });
  });

  describe("permanent (default-deny)", () => {
    it("user/abort without a timeout code", () => {
      expect(classifyMissionRunError(err("aborted", { name: "AbortError" }))).toBe("permanent");
    });
    it("4xx incl 401/403/404/422 (not 429)", () => {
      for (const s of [400, 401, 403, 404, 422]) {
        expect(classifyMissionRunError(err(`returned ${s}`))).toBe("permanent");
        expect(classifyMissionRunError(err("x", { status: s }))).toBe("permanent");
      }
    });
    it("validation / contract / business errors (unknown shape)", () => {
      expect(classifyMissionRunError(err("AGENT_VALIDATION_ERROR: bad args"))).toBe("permanent");
      expect(classifyMissionRunError(err("INSUFFICIENT_BALANCE"))).toBe("permanent");
      expect(classifyMissionRunError(err("HTTP_RESPONSE_INVALID: malformed json"))).toBe("permanent");
    });
    it("non-Error inputs", () => {
      expect(classifyMissionRunError("just a string")).toBe("permanent");
      expect(classifyMissionRunError(null)).toBe("permanent");
      expect(classifyMissionRunError({ message: "fake" })).toBe("permanent");
    });
    it("retryable:false does not force transient; unknown stays permanent", () => {
      expect(classifyMissionRunError(err("mystery", { retryable: false }))).toBe("permanent");
    });
    it("explicit permanent HTTP status beats a contradictory retryable:true", () => {
      // A mapper that wrongly set retryable:true must NOT promote a 401 to transient.
      expect(classifyMissionRunError(err("x", { retryable: true, status: 401 }))).toBe("permanent");
      expect(classifyMissionRunError(err("x", { retryable: true, status: 404 }))).toBe("permanent");
      // …but a 503 with retryable:true is still transient (consistent).
      expect(classifyMissionRunError(err("x", { retryable: true, status: 503 }))).toBe("transient");
    });
  });
});
