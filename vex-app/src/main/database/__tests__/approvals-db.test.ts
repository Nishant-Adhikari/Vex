/**
 * approvals-db tests — JSONB allowlist + reasoning preview.
 *
 * Codex review hard requirement: the renderer never receives the raw
 * `approval_queue.tool_call` JSONB. These tests verify the mapper
 * extracts only `toolName` (best-effort), `toolCallId`, status, and
 * permission — anything else stays in main.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type QueryFn = (
  text: string,
  params?: readonly unknown[],
) => Promise<{ rows: ReadonlyArray<Record<string, unknown>> }>;

const mocks = vi.hoisted(() => ({
  query: vi.fn() as QueryFn,
  connect: vi.fn(),
  end: vi.fn(),
  buildPoolConfig: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("pg", () => {
  function MockClient() {
    return {
      connect: mocks.connect,
      end: mocks.end,
      query: mocks.query,
    };
  }
  return { Client: MockClient };
});

vi.mock("../db-config.js", () => ({
  buildPoolConfig: mocks.buildPoolConfig,
}));

vi.mock("../../logger/index.js", () => ({ log: mocks.log }));

const { getApprovalById, getHistoryForSession, listPendingForSession } =
  await import("../approvals-db.js");

const SESSION = "00000000-0000-4000-8000-00000000bbbb";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buildPoolConfig.mockResolvedValue({
    host: "127.0.0.1",
    port: 5777,
    database: "vex",
    user: "vex",
    password: "secret",
  });
  mocks.connect.mockResolvedValue(undefined);
  mocks.end.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("approvals-db mapper", () => {
  it("never returns raw tool_call to the renderer", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "approval-1",
          status: "pending",
          session_id: SESSION,
          tool_call_id: "tc-1",
          tool_call: {
            namespace: "wallet",
            command: "send",
            args: { to: "0xLEAK", amount: "1000000000000000000" },
            secretField: "do-not-leak",
          },
          reasoning: "User must confirm wallet transfer of 1 ETH",
          permission_at_enqueue: "restricted",
          created_at: "2026-05-21T10:00:00.000Z",
          resolved_at: null,
        },
      ],
    });

    const result = await listPendingForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = result.data[0]!;
    expect(dto.toolName).toBe("wallet:send");
    expect(dto.reasoningPreview).toBe("User must confirm wallet transfer of 1 ETH");
    expect(dto).not.toHaveProperty("toolCall");
    expect(dto).not.toHaveProperty("tool_call");
    expect(dto).not.toHaveProperty("args");
    expect(dto).not.toHaveProperty("secretField");
  });

  it("truncates reasoning to 200 chars", async () => {
    const longReason = "A".repeat(500);
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "approval-2",
          status: "pending",
          session_id: SESSION,
          tool_call_id: null,
          tool_call: null,
          reasoning: longReason,
          permission_at_enqueue: "full",
          created_at: "2026-05-21T10:00:00.000Z",
          resolved_at: null,
        },
      ],
    });
    const result = await listPendingForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]!.reasoningPreview).toHaveLength(200);
  });

  it("returns null toolName when tool_call is not an object", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "approval-3",
          status: "pending",
          session_id: SESSION,
          tool_call_id: null,
          tool_call: "string-value",
          reasoning: null,
          permission_at_enqueue: "restricted",
          created_at: "2026-05-21T10:00:00.000Z",
          resolved_at: null,
        },
      ],
    });
    const result = await listPendingForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]!.toolName).toBeNull();
  });

  it("falls back to status=pending on exotic engine value (defensive)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: "approval-4",
          status: "expired", // not in approvalStatusSchema
          session_id: SESSION,
          tool_call_id: null,
          tool_call: null,
          reasoning: null,
          permission_at_enqueue: "restricted",
          created_at: "2026-05-21T10:00:00.000Z",
          resolved_at: null,
        },
      ],
    });
    const result = await listPendingForSession(SESSION);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data[0]!.status).toBe("pending");
  });

  it("getApprovalById returns null when DB has no row", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const result = await getApprovalById("missing");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
  });

  it("getHistoryForSession passes limit to the SQL query", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    await getHistoryForSession(SESSION, 7);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    const [, params] = mocks.query.mock.calls[0]!;
    expect(params).toEqual([SESSION, 7]);
  });
});
