import { describe, it, expect } from "vitest";
import type { SuiteCtx } from "./context.js";

export function v2ProvenanceSuite(ctx: SuiteCtx): void {
  const { importKnowledge, mockInsertEntry, makeRowLine, lines } = ctx;

  describe("v2 provenance roundtrip", () => {
    it("v2: preserves source_surface='mcp_local' + source_session through insertEntry", async () => {
      await importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
          makeRowLine({
            source_surface: "mcp_local",
            source_session: "mcp-stdio-abc123",
          }),
        ),
      );
      expect(mockInsertEntry).toHaveBeenCalledTimes(1);
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.sourceSurface).toBe("mcp_local");
      expect(arg.sourceSession).toBe("mcp-stdio-abc123");
    });

    it("v2: absent provenance falls through to insertEntry defaults (undefined → 'echo_agent'/NULL)", async () => {
      await importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
          makeRowLine(),
        ),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.sourceSurface).toBeUndefined();
      expect(arg.sourceSession).toBeUndefined();
    });

    it("v2: invalid source_surface value → row fails validation (no insert)", async () => {
      const report = await importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
          makeRowLine({ source_surface: "rogue_surface" }),
        ),
      );
      expect(report.failed).toBe(1);
      expect(report.inserted).toBe(0);
      expect(mockInsertEntry).not.toHaveBeenCalled();
    });

    it("v2: source_session=null is accepted (maps to undefined → DB NULL)", async () => {
      await importKnowledge(
        lines(
          JSON.stringify({ __type: "echoclaw_knowledge_export", version: 2 }),
          makeRowLine({ source_surface: "echo_agent", source_session: null }),
        ),
      );
      const arg = mockInsertEntry.mock.calls[0]![0];
      expect(arg.sourceSurface).toBe("echo_agent");
      expect(arg.sourceSession).toBeUndefined();
    });
  });
}
