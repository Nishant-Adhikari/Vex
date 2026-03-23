import { describe, it, expect } from "vitest";
import { isRecord, createFieldValidators } from "../utils/validation-helpers.js";
import { EchoError } from "../errors.js";

describe("isRecord", () => {
  it("returns true for plain objects", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord({ a: 1 })).toBe(true);
  });

  it("returns false for null", () => {
    expect(isRecord(null)).toBe(false);
  });

  it("returns false for arrays", () => {
    expect(isRecord([])).toBe(false);
    expect(isRecord([1, 2])).toBe(false);
  });

  it("returns false for primitives", () => {
    expect(isRecord(undefined)).toBe(false);
    expect(isRecord("string")).toBe(false);
    expect(isRecord(42)).toBe(false);
    expect(isRecord(true)).toBe(false);
  });
});

describe("createFieldValidators", () => {
  const { asString, asNumber, asOptionalString, asOptionalNumber, asStringArray } =
    createFieldValidators("TEST_ERROR", "TestPrefix");

  describe("asString", () => {
    it("returns valid string", () => {
      expect(asString("hello", "field")).toBe("hello");
    });

    it("throws for empty string", () => {
      expect(() => asString("", "field")).toThrow(EchoError);
      expect(() => asString("", "field")).toThrow(/TestPrefix/);
      expect(() => asString("", "field")).toThrow(/field/);
    });

    it("throws for non-string", () => {
      expect(() => asString(42, "field")).toThrow(EchoError);
      expect(() => asString(null, "field")).toThrow(EchoError);
      expect(() => asString(undefined, "field")).toThrow(EchoError);
    });

    it("uses correct error code", () => {
      try {
        asString(null, "test");
      } catch (err) {
        expect((err as EchoError).code).toBe("TEST_ERROR");
      }
    });
  });

  describe("asNumber", () => {
    it("returns valid number", () => {
      expect(asNumber(42, "field")).toBe(42);
      expect(asNumber(0, "field")).toBe(0);
      expect(asNumber(-1, "field")).toBe(-1);
    });

    it("throws for NaN", () => {
      expect(() => asNumber(NaN, "field")).toThrow(EchoError);
    });

    it("throws for non-number", () => {
      expect(() => asNumber("42", "field")).toThrow(EchoError);
      expect(() => asNumber(null, "field")).toThrow(EchoError);
    });
  });

  describe("asOptionalString", () => {
    it("returns string for valid", () => {
      expect(asOptionalString("hello")).toBe("hello");
    });

    it("returns undefined for empty string", () => {
      expect(asOptionalString("")).toBeUndefined();
    });

    it("returns undefined for non-string", () => {
      expect(asOptionalString(null)).toBeUndefined();
      expect(asOptionalString(42)).toBeUndefined();
      expect(asOptionalString(undefined)).toBeUndefined();
    });
  });

  describe("asOptionalNumber", () => {
    it("returns number for valid", () => {
      expect(asOptionalNumber(42)).toBe(42);
      expect(asOptionalNumber(0)).toBe(0);
    });

    it("returns undefined for NaN", () => {
      expect(asOptionalNumber(NaN)).toBeUndefined();
    });

    it("returns undefined for non-number", () => {
      expect(asOptionalNumber("42")).toBeUndefined();
      expect(asOptionalNumber(null)).toBeUndefined();
    });
  });

  describe("asStringArray", () => {
    it("returns filtered string array", () => {
      expect(asStringArray(["a", "b", "c"])).toEqual(["a", "b", "c"]);
    });

    it("filters non-string entries", () => {
      expect(asStringArray(["a", 42, null, "b"])).toEqual(["a", "b"]);
    });

    it("returns empty array for non-array", () => {
      expect(asStringArray(null)).toEqual([]);
      expect(asStringArray("string")).toEqual([]);
      expect(asStringArray(42)).toEqual([]);
    });
  });
});
