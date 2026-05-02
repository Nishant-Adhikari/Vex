import { describe, expect, it } from "vitest";

import { jsonb, jsonbPlaceholder, nullableJsonb } from "@vex-agent/db/params.js";

describe("db params helpers", () => {
  it("serializes JSONB-safe objects and arrays", () => {
    expect(jsonb({ chain: "solana", rules: ["buy", "sell"], active: true })).toBe(
      '{"chain":"solana","rules":["buy","sell"],"active":true}',
    );
    expect(jsonb(["wallet", "protocol"])).toBe('["wallet","protocol"]');
  });

  it("supports nullable JSONB parameters", () => {
    expect(nullableJsonb(null)).toBeNull();
    expect(nullableJsonb({ next: "/mission start" })).toBe('{"next":"/mission start"}');
  });

  it("builds explicit JSONB placeholders", () => {
    expect(jsonbPlaceholder(4)).toBe("$4::jsonb");
    expect(() => jsonbPlaceholder(0)).toThrow(/positive integer/);
  });

  it("serializes Date values through their JSON representation", () => {
    expect(jsonb({ at: new Date("2026-05-02T12:00:00.000Z") })).toBe(
      '{"at":"2026-05-02T12:00:00.000Z"}',
    );
  });

  it("rejects values that JSONB would silently corrupt or cannot represent", () => {
    expect(() => jsonb(undefined)).toThrow(/unsupported undefined/);
    expect(() => jsonb({ missing: undefined })).toThrow(/unsupported undefined/);
    expect(() => jsonb({ amount: Number.NaN })).toThrow(/non-finite number/);
    expect(() => jsonb({ amount: 1n })).toThrow(/unsupported bigint/);
    expect(() => jsonb(new Map([["k", "v"]]))).toThrow(/unsupported object type/);
  });

  it("rejects circular references", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(() => jsonb(circular)).toThrow(/circular reference/);
  });
});
