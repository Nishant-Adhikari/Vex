/**
 * Phase A2 — verify the namespace lifecycle gate in `executeProtocolTool`.
 *
 * Three behaviors, three cohorts:
 *   - `active` namespace → executes normally.
 *   - `deprecated_hidden` namespace → blocked by default; opens up when
 *     `VEX_ALLOW_DEPRECATED_PROTOCOLS=1`.
 *   - `reserved` namespace → blocked unconditionally.
 *
 * The handler is mocked so we never touch real protocol clients. We mock
 * `getProtocolManifest`/`getProtocolHandler` to return synthetic rows whose
 * `namespace` is a real `ProtocolNamespace` value with a known lifecycle.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ProtocolToolManifest, ProtocolHandler } from "../../../../vex-agent/tools/protocols/types.js";

const fakeHandler: ProtocolHandler = vi.fn(async () => ({
  success: true,
  output: "ok",
}));

vi.mock(import("../../../../vex-agent/tools/protocols/catalog.js"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    getProtocolHandler: (_toolId: string) => fakeHandler,
    getProtocolManifest: (toolId: string): ProtocolToolManifest | undefined => {
      if (toolId === "khalani.fake") {
        return {
          toolId: "khalani.fake", namespace: "khalani", lifecycle: "active",
          description: "Fake active tool", mutating: false, params: [], exampleParams: {},
        };
      }
      if (toolId === "chainscan.fake") {
        return {
          toolId: "chainscan.fake", namespace: "chainscan", lifecycle: "active",
          description: "Fake deprecated tool", mutating: false, params: [], exampleParams: {},
        };
      }
      if (toolId === "0g-compute.fake") {
        return {
          toolId: "0g-compute.fake", namespace: "0g-compute", lifecycle: "active",
          description: "Fake reserved tool", mutating: false, params: [], exampleParams: {},
        };
      }
      return undefined;
    },
  };
});

const { executeProtocolTool } = await import("../../../../vex-agent/tools/protocols/runtime.js");

describe("A2 — protocol runtime namespace lifecycle gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.VEX_ALLOW_DEPRECATED_PROTOCOLS;
  });

  afterEach(() => {
    delete process.env.VEX_ALLOW_DEPRECATED_PROTOCOLS;
  });

  it("active namespace executes normally", async () => {
    const result = await executeProtocolTool(
      { toolId: "khalani.fake", params: {} },
      { sessionPermission: "full", approved: true },
    );
    expect(result.success).toBe(true);
    expect(result.output).toBe("ok");
    expect(fakeHandler).toHaveBeenCalledTimes(1);
  });

  it("deprecated_hidden namespace is blocked by default", async () => {
    const result = await executeProtocolTool(
      { toolId: "chainscan.fake", params: {} },
      { sessionPermission: "full", approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("deprecated_hidden");
    expect(result.output).toContain("VEX_ALLOW_DEPRECATED_PROTOCOLS=1");
    expect(fakeHandler).not.toHaveBeenCalled();
  });

  it("deprecated_hidden namespace executes when env override set", async () => {
    process.env.VEX_ALLOW_DEPRECATED_PROTOCOLS = "1";
    const result = await executeProtocolTool(
      { toolId: "chainscan.fake", params: {} },
      { sessionPermission: "full", approved: true },
    );
    expect(result.success).toBe(true);
    expect(fakeHandler).toHaveBeenCalledTimes(1);
  });

  it("reserved namespace is blocked unconditionally (env override does not help)", async () => {
    process.env.VEX_ALLOW_DEPRECATED_PROTOCOLS = "1";
    const result = await executeProtocolTool(
      { toolId: "0g-compute.fake", params: {} },
      { sessionPermission: "full", approved: true },
    );
    expect(result.success).toBe(false);
    expect(result.output).toContain("reserved");
    expect(fakeHandler).not.toHaveBeenCalled();
  });
});
