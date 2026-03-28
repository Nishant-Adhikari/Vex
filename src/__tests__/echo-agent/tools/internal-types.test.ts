import { describe, it, expect } from "vitest";
import { str, num, bool, ok, fail } from "../../../echo-agent/tools/internal/types.js";

describe("internal types helpers", () => {
  // ── str ──────────────────────────────────────────────────────────

  describe("str", () => {
    it("returns string value", () => {
      expect(str({ name: "hello" }, "name")).toBe("hello");
    });

    it("returns empty string for missing key", () => {
      expect(str({}, "name")).toBe("");
    });

    it("returns empty string for non-string value", () => {
      expect(str({ name: 42 }, "name")).toBe("");
      expect(str({ name: true }, "name")).toBe("");
      expect(str({ name: null }, "name")).toBe("");
      expect(str({ name: undefined }, "name")).toBe("");
    });
  });

  // ── num ──────────────────────────────────────────────────────────

  describe("num", () => {
    it("returns number value", () => {
      expect(num({ count: 5 }, "count")).toBe(5);
    });

    it("returns zero", () => {
      expect(num({ count: 0 }, "count")).toBe(0);
    });

    it("returns undefined for missing key", () => {
      expect(num({}, "count")).toBeUndefined();
    });

    it("returns undefined for non-number value", () => {
      expect(num({ count: "5" }, "count")).toBeUndefined();
      expect(num({ count: true }, "count")).toBeUndefined();
    });
  });

  // ── bool ─────────────────────────────────────────────────────────

  describe("bool", () => {
    it("returns true for true", () => {
      expect(bool({ flag: true }, "flag")).toBe(true);
    });

    it("returns false for anything else", () => {
      expect(bool({ flag: false }, "flag")).toBe(false);
      expect(bool({ flag: "true" }, "flag")).toBe(false);
      expect(bool({ flag: 1 }, "flag")).toBe(false);
      expect(bool({}, "flag")).toBe(false);
    });
  });

  // ── ok ───────────────────────────────────────────────────────────

  describe("ok", () => {
    it("returns success result with JSON output", () => {
      const result = ok({ count: 3, items: ["a", "b", "c"] });
      expect(result.success).toBe(true);
      expect(result.output).toBe(JSON.stringify({ count: 3, items: ["a", "b", "c"] }, null, 2));
      expect(result.data).toEqual({ count: 3, items: ["a", "b", "c"] });
    });

    it("handles string input", () => {
      const result = ok("simple");
      expect(result.success).toBe(true);
      expect(result.output).toBe('"simple"');
    });

    it("handles null", () => {
      const result = ok(null);
      expect(result.success).toBe(true);
      expect(result.output).toBe("null");
    });
  });

  // ── fail ─────────────────────────────────────────────────────────

  describe("fail", () => {
    it("returns failure result with message", () => {
      const result = fail("Something went wrong");
      expect(result.success).toBe(false);
      expect(result.output).toBe("Something went wrong");
      expect(result.data).toBeUndefined();
    });
  });
});
