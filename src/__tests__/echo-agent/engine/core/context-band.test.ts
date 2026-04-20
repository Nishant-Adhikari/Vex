import { describe, it, expect } from "vitest";
import {
  computeBand,
  WARNING_THRESHOLD,
  CRITICAL_THRESHOLD,
} from "../../../../echo-agent/engine/core/context-band.js";

describe("context-band / computeBand", () => {
  const LIMIT = 128_000;

  describe("normal band — tokenCount below WARNING", () => {
    it("empty session (0 tokens) is normal", () => {
      expect(computeBand(0, LIMIT)).toBe("normal");
    });

    it("50% usage is normal", () => {
      expect(computeBand(LIMIT * 0.5, LIMIT)).toBe("normal");
    });

    it("just below warning threshold (79.99%) is normal", () => {
      expect(computeBand(LIMIT * 0.7999, LIMIT)).toBe("normal");
    });
  });

  describe("warning band — tokenCount in [80%, 90%)", () => {
    it("exactly at warning threshold (80%) is warning", () => {
      expect(computeBand(LIMIT * WARNING_THRESHOLD, LIMIT)).toBe("warning");
    });

    it("85% usage is warning", () => {
      expect(computeBand(LIMIT * 0.85, LIMIT)).toBe("warning");
    });

    it("just below critical threshold (89.99%) is warning", () => {
      expect(computeBand(LIMIT * 0.8999, LIMIT)).toBe("warning");
    });
  });

  describe("critical band — tokenCount >= 90%", () => {
    it("exactly at critical threshold (90%) is critical", () => {
      expect(computeBand(LIMIT * CRITICAL_THRESHOLD, LIMIT)).toBe("critical");
    });

    it("95% usage is critical", () => {
      expect(computeBand(LIMIT * 0.95, LIMIT)).toBe("critical");
    });

    it("over 100% (past-limit) is still classified critical, not thrown", () => {
      expect(computeBand(LIMIT * 2, LIMIT)).toBe("critical");
    });
  });

  describe("degenerate inputs", () => {
    it("zero contextLimit falls back to normal (no division by zero)", () => {
      expect(computeBand(1000, 0)).toBe("normal");
    });

    it("negative contextLimit falls back to normal", () => {
      expect(computeBand(1000, -1)).toBe("normal");
    });

    it("negative tokenCount is treated as empty → normal", () => {
      expect(computeBand(-500, LIMIT)).toBe("normal");
    });

    it("NaN tokenCount falls back to normal", () => {
      expect(computeBand(Number.NaN, LIMIT)).toBe("normal");
    });

    it("Infinity contextLimit falls back to normal", () => {
      expect(computeBand(1000, Number.POSITIVE_INFINITY)).toBe("normal");
    });
  });

  describe("threshold constants", () => {
    it("WARNING is 0.80 and CRITICAL is 0.90 (load-bearing for PR-9 forced-pass gate)", () => {
      expect(WARNING_THRESHOLD).toBe(0.80);
      expect(CRITICAL_THRESHOLD).toBe(0.90);
    });
  });
});
