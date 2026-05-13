import { describe, it, expect } from "vitest";
import { makeProductionContext } from "../../mcp/context.js";

describe("mcp context — makeProductionContext", () => {
  it("sets dispatcher gate bypass flags (sessionPermission:full, approved:true)", () => {
    const ctx = makeProductionContext("mcp-stdio-test123");
    expect(ctx.sessionPermission).toBe("full");
    expect(ctx.approved).toBe(true);
  });

  it("sets parent role so child-only subagent tools are excluded by registry", () => {
    const ctx = makeProductionContext("mcp-stdio-test123");
    expect(ctx.role).toBe("parent");
  });

  it("uses 'mcp_local' as knowledge provenance source surface", () => {
    const ctx = makeProductionContext("mcp-stdio-test123");
    expect(ctx.sourceSurface).toBe("mcp_local");
  });

  it("propagates the supplied sessionId into both sessionId and sourceSession", () => {
    const ctx = makeProductionContext("mcp-stdio-abcdef0123");
    expect(ctx.sessionId).toBe("mcp-stdio-abcdef0123");
    expect(ctx.sourceSession).toBe("mcp-stdio-abcdef0123");
  });

  it("starts with an empty loadedDocuments Map", () => {
    const ctx = makeProductionContext("mcp-stdio-test123");
    expect(ctx.loadedDocuments).toBeInstanceOf(Map);
    expect(ctx.loadedDocuments.size).toBe(0);
  });

  it("missionRunId is null (MCP is not a mission run)", () => {
    const ctx = makeProductionContext("mcp-stdio-test123");
    expect(ctx.missionRunId).toBeNull();
  });

  it("returns a fresh object each call (no shared state)", () => {
    const a = makeProductionContext("a");
    const b = makeProductionContext("b");
    expect(a).not.toBe(b);
    expect(a.loadedDocuments).not.toBe(b.loadedDocuments);
    a.loadedDocuments.set("x", "y");
    expect(b.loadedDocuments.size).toBe(0);
  });
});
