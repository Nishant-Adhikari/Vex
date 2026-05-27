/**
 * messages-db tests — JSONB allowlist + redaction.
 *
 * Codex review hard requirement: every mapper that reduces DB JSONB to
 * a renderer-visible DTO must be allowlisted and validated. These tests
 * exercise `tool_calls` extraction + `metadata` redaction without ever
 * touching a live Postgres — we mock `pg.Client.query` and verify the
 * mapper output shape directly.
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

const { getMessageTail, listMessages } = await import("../messages-db.js");

const SESSION = "00000000-0000-4000-8000-00000000abcd";

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

describe("messages-db mapper", () => {
  it("extracts namespace:command from tool_calls without leaking raw JSONB", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 1,
          session_id: SESSION,
          role: "assistant",
          content: "calling tool",
          tool_call_id: null,
          tool_calls: [
            {
              namespace: "wallet",
              command: "send",
              args: { to: "0xLEAK", value: "0xSECRET" },
              extraField: "private",
            },
          ],
          created_at: "2026-05-21T10:00:00.000Z",
          source: "agent",
          message_type: "chat",
          metadata: { secretKey: "leak-me" },
        },
      ],
    });

    const result = await getMessageTail(SESSION, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(1);
    const msg = result.data.items[0]!;
    expect(msg.toolName).toBe("wallet:send");
    // The DTO surface must NOT carry the args / extraField / secretKey
    expect(Object.keys(msg)).toEqual(
      expect.arrayContaining([
        "id",
        "sessionId",
        "role",
        "kind",
        "content",
        "createdAt",
        "toolCallId",
        "toolName",
      ]),
    );
    expect(msg).not.toHaveProperty("metadata");
    expect(msg).not.toHaveProperty("tool_calls");
    expect(msg).not.toHaveProperty("toolCalls");
  });

  it("falls back to command, then name, then null when namespace is absent", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 2,
          session_id: SESSION,
          role: "assistant",
          content: "",
          tool_call_id: null,
          tool_calls: [{ command: "ping" }],
          created_at: "2026-05-21T10:00:00.000Z",
          source: null,
          message_type: null,
          metadata: null,
        },
        {
          id: 3,
          session_id: SESSION,
          role: "assistant",
          content: "",
          tool_call_id: null,
          tool_calls: [{ name: "fallback" }],
          created_at: "2026-05-21T10:01:00.000Z",
          source: null,
          message_type: null,
          metadata: null,
        },
        {
          id: 4,
          session_id: SESSION,
          role: "assistant",
          content: "",
          tool_call_id: null,
          tool_calls: [{ junk: 1 }],
          created_at: "2026-05-21T10:02:00.000Z",
          source: null,
          message_type: null,
          metadata: null,
        },
      ],
    });

    const result = await getMessageTail(SESSION, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // tail returns chronological order (oldest first); items[0] corresponds
    // to row #4 because DESC query gives 4,3,2 then we reverse for render.
    const byId = new Map(result.data.items.map((m) => [m.id, m.toolName]));
    expect(byId.get(2)).toBe("ping");
    expect(byId.get(3)).toBe("fallback");
    expect(byId.get(4)).toBe(null);
  });

  it("rejects non-string namespace/command values (no type coercion)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 5,
          session_id: SESSION,
          role: "assistant",
          content: "",
          tool_call_id: null,
          tool_calls: [{ namespace: 42, command: { nested: "x" } }],
          created_at: "2026-05-21T10:00:00.000Z",
          source: null,
          message_type: null,
          metadata: null,
        },
      ],
    });

    const result = await getMessageTail(SESSION, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]!.toolName).toBeNull();
  });

  it("derives runtime_notice kind from message_type without forwarding JSONB", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 6,
          session_id: SESSION,
          role: "system",
          content: "Run resumed",
          tool_call_id: null,
          tool_calls: null,
          created_at: "2026-05-21T10:00:00.000Z",
          source: "engine",
          message_type: "wake_banner",
          metadata: { kind: "wake", privateData: "leak" },
        },
      ],
    });

    const result = await getMessageTail(SESSION, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]!.kind).toBe("runtime_notice");
    expect(result.data.items[0]).not.toHaveProperty("metadata");
  });

  it("maps a compaction_committed marker row to the compaction kind (8-4)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 7,
          session_id: SESSION,
          role: "system",
          content: "Conversation compacted into memory · checkpoint 2",
          tool_call_id: null,
          tool_calls: null,
          created_at: "2026-05-21T10:00:00.000Z",
          source: "engine",
          message_type: "compaction_committed",
          metadata: null,
        },
      ],
    });
    const result = await getMessageTail(SESSION, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]!.kind).toBe("compaction");
  });

  it("maps an assistant chat_stopped row to the assistant_stopped kind (9-5b)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 70,
          session_id: SESSION,
          role: "assistant",
          content: "The balance is",
          tool_call_id: null,
          tool_calls: null,
          created_at: "2026-05-21T10:00:00.000Z",
          source: "agent",
          message_type: "chat_stopped",
          metadata: null,
        },
      ],
    });
    const result = await getMessageTail(SESSION, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]!.kind).toBe("assistant_stopped");
    expect(result.data.items[0]!.content).toBe("The balance is");
  });

  it("keeps a non-assistant chat_stopped row as runtime_notice (role-guarded) (9-5b)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 71,
          session_id: SESSION,
          role: "system",
          content: "stray",
          tool_call_id: null,
          tool_calls: null,
          created_at: "2026-05-21T10:00:00.000Z",
          source: "engine",
          message_type: "chat_stopped",
          metadata: null,
        },
      ],
    });
    const result = await getMessageTail(SESSION, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]!.kind).toBe("runtime_notice");
  });

  it("maps memory_recall / knowledge_recall tool-call rows to the recall kind and keeps assistant prose (8-4)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 8,
          session_id: SESSION,
          role: "assistant",
          content: "Let me check what I remember.",
          tool_call_id: null,
          tool_calls: [{ command: "memory_recall", args: { query: "x" } }],
          created_at: "2026-05-21T10:00:00.000Z",
          source: "agent",
          message_type: "chat",
          metadata: null,
        },
        {
          id: 9,
          session_id: SESSION,
          role: "assistant",
          content: "",
          tool_call_id: null,
          tool_calls: [{ command: "knowledge_recall", args: {} }],
          created_at: "2026-05-21T10:01:00.000Z",
          source: "agent",
          message_type: "chat",
          metadata: null,
        },
      ],
    });
    const result = await getMessageTail(SESSION, 10);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.data.items.map((m) => [m.id, m]));
    expect(byId.get(8)!.kind).toBe("recall");
    expect(byId.get(8)!.toolName).toBe("memory_recall");
    // Codex constraint: non-empty assistant prose on a recall row is preserved.
    expect(byId.get(8)!.content).toBe("Let me check what I remember.");
    expect(byId.get(9)!.kind).toBe("recall");
    expect(byId.get(9)!.toolName).toBe("knowledge_recall");
  });

  it("keeps a normal tool-call row as tool_call (recall detection is narrow) (8-4)", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          id: 10,
          session_id: SESSION,
          role: "assistant",
          content: "",
          tool_call_id: null,
          tool_calls: [{ namespace: "polymarket", command: "order" }],
          created_at: "2026-05-21T10:00:00.000Z",
          source: "agent",
          message_type: "chat",
          metadata: null,
        },
      ],
    });
    const result = await getMessageTail(SESSION, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items[0]!.kind).toBe("tool_call");
    expect(result.data.items[0]!.toolName).toBe("polymarket:order");
  });

  it("uses cursor-based DESC ordering with overflow page for hasMore=true", async () => {
    mocks.query.mockResolvedValueOnce({
      rows: Array.from({ length: 6 }, (_, idx) => ({
        id: 100 - idx,
        session_id: SESSION,
        role: "user",
        content: `m${idx}`,
        tool_call_id: null,
        tool_calls: null,
        created_at: `2026-05-21T10:0${idx}:00.000Z`,
        source: null,
        message_type: "chat",
        metadata: null,
      })),
    });

    const result = await listMessages(SESSION, null, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(5);
    expect(result.data.hasMore).toBe(true);
    expect(result.data.nextCursor).not.toBeNull();
  });

  it("returns ok({}) shape (no error) when DB has zero messages for session", async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });
    const result = await getMessageTail(SESSION, 5);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toEqual([]);
    expect(result.data.hasMore).toBe(false);
    expect(result.data.nextCursor).toBeNull();
  });

  it("dbUnavailable when buildPoolConfig returns null", async () => {
    mocks.buildPoolConfig.mockReset();
    mocks.buildPoolConfig.mockResolvedValueOnce(null);
    const result = await getMessageTail(SESSION, 5);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("internal.unexpected");
    expect(result.error.domain).toBe("messages");
  });
});
