/**
 * Tests for ChatMode type guard and validation integration.
 */

import { describe, it, expect } from "vitest";
import { toChatMode } from "../../agent/types.js";

describe("toChatMode type guard", () => {
  it("returns 'full' for 'full'", () => {
    expect(toChatMode("full")).toBe("full");
  });

  it("returns 'restricted' for 'restricted'", () => {
    expect(toChatMode("restricted")).toBe("restricted");
  });

  it("returns 'off' for 'off'", () => {
    expect(toChatMode("off")).toBe("off");
  });

  it("returns 'restricted' for null", () => {
    expect(toChatMode(null)).toBe("restricted");
  });

  it("returns 'restricted' for undefined", () => {
    expect(toChatMode(undefined)).toBe("restricted");
  });

  it("returns 'restricted' for empty string", () => {
    expect(toChatMode("")).toBe("restricted");
  });

  it("returns 'restricted' for invalid string 'auto'", () => {
    expect(toChatMode("auto")).toBe("restricted");
  });

  it("returns 'restricted' for number input", () => {
    expect(toChatMode(42)).toBe("restricted");
  });

  it("returns 'restricted' for boolean input", () => {
    expect(toChatMode(true)).toBe("restricted");
  });

  it("returns 'restricted' for object input", () => {
    expect(toChatMode({})).toBe("restricted");
  });
});
