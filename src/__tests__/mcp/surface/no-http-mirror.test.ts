/**
 * B2 cleanup-light verification — `src/mcp/docs/http-mirror.ts` is gone
 * and no module imports it.
 *
 * The MCP transports retain JSON-RPC over stdio and Streamable HTTP. The
 * Fastify-routes nakładka that previously mirrored the resource surface
 * over plain HTTP (`mountHttpDocs`) was deleted: documentation is served
 * by MCP resources (`docs://*`, `surface://manifest`, `runtime://env`)
 * and by the new internal tools `vex_introduction` / `vex_namespace_tools`.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const MIRROR_PATH = resolve(import.meta.dirname, "../../../mcp/docs/http-mirror.ts");

describe("B2 — no http-mirror surface", () => {
  it("`http-mirror.ts` no longer exists in the source tree", () => {
    expect(existsSync(MIRROR_PATH)).toBe(false);
  });

  it("import of the deleted module fails", async () => {
    let imported = false;
    try {
      // @ts-expect-error — deliberate import of removed module.
      await import("../../../mcp/docs/http-mirror.js");
      imported = true;
    } catch {
      imported = false;
    }
    expect(imported).toBe(false);
  });
});
