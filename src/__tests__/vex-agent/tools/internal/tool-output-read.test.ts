/**
 * PR-11 — `tool_output_read` handler coverage.
 *
 * Tested:
 *   - Zod format guard on blob_key,
 *   - session-scope enforcement (cross-session rejected),
 *   - missing / expired blob → clean error + fires cleanupExpired lazily,
 *   - happy path returns bounded slices + paging metadata.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadBlob = vi.fn();
const mockCleanupExpired = vi.fn();

vi.mock("@vex-agent/db/repos/tool-output-blobs.js", () => ({
  readBlob: (...a: unknown[]) => mockReadBlob(...a),
  cleanupExpired: (...a: unknown[]) => mockCleanupExpired(...a),
}));

const { handleToolOutputRead } = await import(
  "../../../../vex-agent/tools/internal/tool-output-read.js"
);

function makeCtx(sessionId = "s1") {
  return {
    sessionId,
    loadedDocuments: new Map<string, string>(),
    sessionPermission: "restricted" as const,
    approved: false,
    role: "parent" as const,
    missionRunId: null,
    missionId: null,
    sessionKind: "mission" as const,
    contextUsageBand: "normal" as const,
  };
}

const validKey = "tob-20260420-0123456789abcdef";

beforeEach(() => {
  vi.clearAllMocks();
  mockCleanupExpired.mockResolvedValue(0);
});

describe("tool_output_read handler", () => {
  it("returns a bounded first slice + metadata on hit", async () => {
    const fullOutput = "a".repeat(20_000);
    mockReadBlob.mockResolvedValue({
      blobKey: validKey,
      sessionId: "s1",
      payload: {
        fullOutput,
        shapeKind: "json",
        sizeBytes: Buffer.byteLength(fullOutput, "utf8"),
        primaryPath: "$.data",
        fieldHints: ["tx_hash", "balance"],
      },
      expiresAt: "2026-04-20T13:00:00.000Z",
      createdAt: "2026-04-20T12:45:00.000Z",
    });

    const result = await handleToolOutputRead({ blob_key: validKey }, makeCtx("s1"));

    expect(result.success).toBe(true);
    expect(result.output).toContain("bytes_returned=8192");
    expect(result.output).toContain("next_offset=8192");
    expect(result.output).toContain("truncated=true");
    expect(result.output).toContain("a".repeat(100));
    expect(result.data).toEqual(expect.objectContaining({
      blob_key: validKey,
      shape_kind: "json",
      size_bytes: 20000,
      offset: 0,
      bytes_returned: 8192,
      next_offset: 8192,
      truncated: true,
      primary_path: "$.data",
      field_hints: ["tx_hash", "balance"],
      expires_at: "2026-04-20T13:00:00.000Z",
    }));
  });

  it("uses offset and max_bytes to page through a payload", async () => {
    mockReadBlob.mockResolvedValue({
      blobKey: validKey,
      sessionId: "s1",
      payload: { fullOutput: "0123456789", shapeKind: "text", sizeBytes: 10 },
      expiresAt: "2026-04-20T13:00:00.000Z",
      createdAt: "2026-04-20T12:45:00.000Z",
    });

    const result = await handleToolOutputRead(
      { blob_key: validKey, offset: 3, max_bytes: 4 },
      makeCtx("s1"),
    );

    expect(result.success).toBe(true);
    expect(result.output).toContain("offset=3");
    expect(result.output).toContain("bytes_returned=4");
    expect(result.output).toContain("next_offset=7");
    expect(result.output).toMatch(/\n3456$/);
    expect(result.data).toEqual(expect.objectContaining({
      offset: 3,
      bytes_returned: 4,
      next_offset: 7,
      truncated: true,
    }));
  });

  it("caps max_bytes below the overflow threshold", async () => {
    const fullOutput = "b".repeat(20_000);
    mockReadBlob.mockResolvedValue({
      blobKey: validKey,
      sessionId: "s1",
      payload: { fullOutput, shapeKind: "text", sizeBytes: 20_000 },
      expiresAt: "2026-04-20T13:00:00.000Z",
      createdAt: "2026-04-20T12:45:00.000Z",
    });

    const result = await handleToolOutputRead(
      { blob_key: validKey, max_bytes: 100_000 },
      makeCtx("s1"),
    );

    expect(result.success).toBe(true);
    expect(Buffer.byteLength(result.output, "utf8")).toBeLessThan(16 * 1024);
    expect(result.data).toEqual(expect.objectContaining({
      bytes_returned: 12_288,
      next_offset: 12_288,
      truncated: true,
    }));
  });

  it("rejects offsets beyond the payload size", async () => {
    mockReadBlob.mockResolvedValue({
      blobKey: validKey,
      sessionId: "s1",
      payload: { fullOutput: "short", shapeKind: "text", sizeBytes: 5 },
      expiresAt: "2026-04-20T13:00:00.000Z",
      createdAt: "2026-04-20T12:45:00.000Z",
    });

    const result = await handleToolOutputRead(
      { blob_key: validKey, offset: 6 },
      makeCtx("s1"),
    );

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/beyond payload size/);
  });

  it("rejects a malformed blob_key at the Zod boundary", async () => {
    const result = await handleToolOutputRead({ blob_key: "not-a-blob-key" }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/blob_key/);
    expect(mockReadBlob).not.toHaveBeenCalled();
  });

  it("returns an error + fires cleanupExpired on missing / expired blob", async () => {
    mockReadBlob.mockResolvedValue(null);
    const result = await handleToolOutputRead({ blob_key: validKey }, makeCtx());
    expect(result.success).toBe(false);
    expect(result.output).toMatch(/not found or expired/);
    expect(mockCleanupExpired).toHaveBeenCalled();
  });

  it("rejects cross-session reads (defense in depth)", async () => {
    mockReadBlob.mockResolvedValue({
      blobKey: validKey,
      sessionId: "other-session",
      payload: { fullOutput: "secret", shapeKind: "text", sizeBytes: 6 },
      expiresAt: "2026-04-20T13:00:00.000Z",
      createdAt: "2026-04-20T12:45:00.000Z",
    });

    const result = await handleToolOutputRead({ blob_key: validKey }, makeCtx("s1"));

    expect(result.success).toBe(false);
    expect(result.output).toMatch(/not readable from this session/);
  });

  it("rejects empty blob_key", async () => {
    const result = await handleToolOutputRead({ blob_key: "" }, makeCtx());
    expect(result.success).toBe(false);
    expect(mockReadBlob).not.toHaveBeenCalled();
  });
});
