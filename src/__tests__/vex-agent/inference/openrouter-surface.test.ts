/**
 * Surface guard — `inference/openrouter.ts` façade.
 *
 * After extracting the post-SDK stream-consumption loop into
 * `inference/openrouter/stream.ts`, the original path keeps its identical
 * public surface: the ONLY runtime export is the `OpenRouterProvider` class.
 * This test pins the EXACT public runtime surface (every exported value
 * present with the right `typeof`, and no extra keys) so a future refactor
 * cannot silently drop or add an export.
 *
 * Importers (`src/lib/openrouter-client.ts`, `compact-jobs/chunker-call.ts`,
 * `inference/registry.ts`) consume only `OpenRouterProvider`.
 */

import { describe, it, expect } from "vitest";

import * as openrouter from "@vex-agent/inference/openrouter.js";

describe("openrouter façade surface", () => {
  it("exposes OpenRouterProvider as a class (function)", () => {
    expect(typeof openrouter.OpenRouterProvider).toBe("function");
  });

  it("exports the exact set of runtime keys (no drift)", () => {
    expect(Object.keys(openrouter).sort()).toEqual(["OpenRouterProvider"].sort());
  });
});
