/**
 * PR-11 — `tool_output_read` handler coverage.
 *
 * Tested:
 *   - Zod format guard on blob_key,
 *   - session-scope enforcement (cross-session rejected),
 *   - missing / expired blob → clean error + fires cleanupExpired lazily,
 *   - happy path returns full payload + metadata.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockReadBlob = vi.fn();
const mockCleanupExpired = vi.fn();

vi.mock("@echo-agent/db/repos/tool-output-blobs.js", () => ({
  readBlob: (...a: unknown[]) => mockReadBlob(...a),
  cleanupExpired: (...a: unknown[]) => mockCleanupExpired(...a),
}));

const { handleToolOutputRead } = await import(
  "../../../../echo-agent/tools/internal/tool-output-read.js"
);

function makeCtx(sessionId = "s1") {
  return {
    sessionId,
    loadedDocuments: new Map<string, string>(),
    loopMode: "restricted" as const,
    approved: false,
    role: "parent" as const,
    missionRunId: null,
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
  it("returns the full payload + metadata on hit", async () => {
    mockReadBlob.mockResolvedValue({
      blobKey: validKey,
      sessionId: "s1",
      payload: {
        fullOutput: "huge tool response here",
        shapeKind: "json",
        sizeBytes: 20000,
        primaryPath: "$.data",
        fieldHints: ["tx_hash", "balance"],
      },
      expiresAt: "2026-04-20T13:00:00.000Z",
      createdAt: "2026-04-20T12:45:00.000Z",
    });

    const result = await handleToolOutputRead({ blob_key: validKey }, makeCtx("s1"));

    expect(result.success).toBe(true);
    expect(result.output).toBe("huge tool response here");
    expect(result.data).toEqual(expect.objectContaining({
      blob_key: validKey,
      shape_kind: "json",
      size_bytes: 20000,
      primary_path: "$.data",
      field_hints: ["tx_hash", "balance"],
      expires_at: "2026-04-20T13:00:00.000Z",
    }));
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
