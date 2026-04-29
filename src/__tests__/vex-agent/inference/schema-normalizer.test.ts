import { describe, it, expect } from "vitest";
import { normalizeToolSchemaForProvider } from "../../../vex-agent/inference/schema-normalizer.js";
import type { JsonSchema } from "../../../vex-agent/tools/types.js";

describe("schema-normalizer — provider strict-mode bridge", () => {
  it("injects items: { type: 'string' } on bare arrays", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array", description: "Optional tags" },
      },
      required: ["tags"],
    };
    const out = normalizeToolSchemaForProvider(input);
    expect(out.properties.tags).toEqual({
      type: "array",
      description: "Optional tags",
      items: { type: "string" },
    });
  });

  it("preserves explicit author-supplied items", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "number" } },
      },
    };
    const out = normalizeToolSchemaForProvider(input);
    expect(out.properties.ids?.items).toEqual({ type: "number" });
  });

  it("forces additionalProperties: false on top-level when omitted", () => {
    const input: JsonSchema = {
      type: "object",
      properties: { query: { type: "string" } },
    };
    const out = normalizeToolSchemaForProvider(input);
    expect(out.additionalProperties).toBe(false);
  });

  it("preserves explicit additionalProperties: true", () => {
    const input: JsonSchema = {
      type: "object",
      properties: { query: { type: "string" } },
      additionalProperties: true,
    };
    const out = normalizeToolSchemaForProvider(input);
    expect(out.additionalProperties).toBe(true);
  });

  it("injects additionalProperties: false on nested objects with properties", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        meta: {
          type: "object",
          properties: {
            owner: { type: "string" },
          },
        },
      },
    };
    const out = normalizeToolSchemaForProvider(input);
    expect(out.properties.meta?.additionalProperties).toBe(false);
  });

  it("does not touch object property without nested properties (free-form bag)", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        source_refs: { type: "object", description: "Provenance map" },
      },
    };
    const out = normalizeToolSchemaForProvider(input);
    // Free-form object stays free-form — no nested properties means we don't
    // claim the shape is closed.
    expect(out.properties.source_refs?.additionalProperties).toBeUndefined();
  });

  it("is idempotent — running twice produces the same result", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array" },
        meta: {
          type: "object",
          properties: { owner: { type: "string" } },
        },
      },
    };
    const once = normalizeToolSchemaForProvider(input);
    const twice = normalizeToolSchemaForProvider(once);
    expect(twice).toEqual(once);
  });

  it("does not mutate the input schema", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        tags: { type: "array" },
      },
    };
    const snapshot = JSON.parse(JSON.stringify(input));
    normalizeToolSchemaForProvider(input);
    expect(input).toEqual(snapshot);
  });

  it("recurses into nested arrays of objects", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        events: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "number" } },
          },
        },
      },
    };
    const out = normalizeToolSchemaForProvider(input);
    expect(out.properties.events?.items?.additionalProperties).toBe(false);
  });

  it("preserves required on top-level and nested objects", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {
        meta: {
          type: "object",
          properties: { owner: { type: "string" } },
          required: ["owner"],
        },
      },
      required: ["meta"],
    };
    const out = normalizeToolSchemaForProvider(input);
    expect(out.required).toEqual(["meta"]);
    expect(out.properties.meta?.required).toEqual(["owner"]);
  });

  it("works on schema with empty properties", () => {
    const input: JsonSchema = {
      type: "object",
      properties: {},
    };
    const out = normalizeToolSchemaForProvider(input);
    expect(out).toEqual({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
  });
});
