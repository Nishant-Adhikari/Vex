import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.fn().mockResolvedValue(undefined);
const mockSetScope = vi.fn().mockResolvedValue(undefined);
const mockEnd = vi.fn().mockResolvedValue(undefined);

vi.mock("@echo-agent/db/repos/sessions.js", () => ({
  createSession: (...args: unknown[]) => mockCreate(...args),
  setScope: (...args: unknown[]) => mockSetScope(...args),
  endSession: (...args: unknown[]) => mockEnd(...args),
}));

const { createMcpSession, endMcpSession } = await import("../../mcp/sessions.js");

describe("mcp sessions", () => {
  beforeEach(() => {
    mockCreate.mockClear();
    mockSetScope.mockClear();
    mockEnd.mockClear();
  });

  describe("createMcpSession", () => {
    it("generates an id of the form mcp-stdio-<token> for stdio transport", async () => {
      const id = await createMcpSession({ transport: "stdio" });
      expect(id).toMatch(/^mcp-stdio-/);
      expect(id.length).toBeGreaterThan("mcp-stdio-".length);
    });

    it("uses externalId for http transport when provided", async () => {
      const id = await createMcpSession({
        transport: "http",
        externalId: "abc-123",
      });
      expect(id).toBe("mcp-http-abc-123");
    });

    it("falls back to nanoid for http transport without externalId", async () => {
      const id = await createMcpSession({ transport: "http" });
      expect(id).toMatch(/^mcp-http-/);
      expect(id.length).toBeGreaterThan("mcp-http-".length);
    });

    it("calls sessionsRepo.createSession with the generated id", async () => {
      const id = await createMcpSession({ transport: "stdio" });
      expect(mockCreate).toHaveBeenCalledTimes(1);
      expect(mockCreate).toHaveBeenCalledWith(id);
    });

    it("sets session scope to 'mcp'", async () => {
      const id = await createMcpSession({ transport: "stdio" });
      expect(mockSetScope).toHaveBeenCalledTimes(1);
      expect(mockSetScope).toHaveBeenCalledWith(id, "mcp");
    });

    it("generates unique ids on successive calls (stdio)", async () => {
      const id1 = await createMcpSession({ transport: "stdio" });
      const id2 = await createMcpSession({ transport: "stdio" });
      expect(id1).not.toBe(id2);
    });
  });

  describe("endMcpSession", () => {
    it("delegates to sessionsRepo.endSession", async () => {
      await endMcpSession("mcp-stdio-test");
      expect(mockEnd).toHaveBeenCalledTimes(1);
      expect(mockEnd).toHaveBeenCalledWith("mcp-stdio-test");
    });

    it("does not throw when sessionsRepo.endSession rejects", async () => {
      mockEnd.mockRejectedValueOnce(new Error("DB unreachable"));
      await expect(endMcpSession("mcp-stdio-test")).resolves.toBeUndefined();
    });

    it("is safe to call twice on the same id (idempotent at repo level)", async () => {
      await endMcpSession("mcp-stdio-test");
      await endMcpSession("mcp-stdio-test");
      expect(mockEnd).toHaveBeenCalledTimes(2);
    });
  });
});
