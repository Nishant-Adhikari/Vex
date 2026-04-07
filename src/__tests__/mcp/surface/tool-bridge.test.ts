import { describe, it, expect } from "vitest";
import { z } from "zod";
import { jsonSchemaToZodShape } from "../../../mcp/surface/tool-bridge.js";
import type { JsonSchema } from "../../../echo-agent/tools/types.js";

describe("mcp surface — JsonSchema → Zod walker", () => {
  it("handles a simple required string property", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        query: { type: "string", description: "Search query" },
      },
      required: ["query"],
    };
    const shape = jsonSchemaToZodShape(schema);
    expect(shape.query).toBeDefined();
    // Required string parses non-empty strings.
    const obj = z.object(shape);
    expect(obj.parse({ query: "hello" })).toEqual({ query: "hello" });
    // Missing required key fails.
    expect(() => obj.parse({})).toThrow();
  });

  it("handles optional properties", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "number" },
      },
      required: ["query"],
    };
    const shape = jsonSchemaToZodShape(schema);
    const obj = z.object(shape);
    expect(obj.parse({ query: "hello" })).toEqual({ query: "hello" });
    expect(obj.parse({ query: "hello", limit: 5 })).toEqual({ query: "hello", limit: 5 });
  });

  it("handles enum string properties", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        status: { type: "string", enum: ["active", "archived"] },
      },
      required: ["status"],
    };
    const shape = jsonSchemaToZodShape(schema);
    const obj = z.object(shape);
    expect(obj.parse({ status: "active" })).toEqual({ status: "active" });
    expect(() => obj.parse({ status: "invalid" })).toThrow();
  });

  it("handles boolean and number properties", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        pinned: { type: "boolean" },
        ttl_hours: { type: "number" },
      },
    };
    const shape = jsonSchemaToZodShape(schema);
    const obj = z.object(shape);
    expect(obj.parse({ pinned: true, ttl_hours: 24 })).toEqual({ pinned: true, ttl_hours: 24 });
    expect(() => obj.parse({ pinned: "yes" })).toThrow();
  });

  it("handles array and object properties as opaque", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array" },
        source_refs: { type: "object" },
      },
    };
    const shape = jsonSchemaToZodShape(schema);
    const obj = z.object(shape);
    expect(obj.parse({ tags: ["a", "b"], source_refs: { protocol: [1, 2] } })).toEqual({
      tags: ["a", "b"],
      source_refs: { protocol: [1, 2] },
    });
  });

  it("handles empty properties object", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {},
    };
    const shape = jsonSchemaToZodShape(schema);
    expect(shape).toEqual({});
    const obj = z.object(shape);
    expect(obj.parse({})).toEqual({});
  });

  it("handles a schema with no required list (all optional)", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "number" },
      },
    };
    const shape = jsonSchemaToZodShape(schema);
    const obj = z.object(shape);
    expect(obj.parse({})).toEqual({});
    expect(obj.parse({ a: "x" })).toEqual({ a: "x" });
  });
});
