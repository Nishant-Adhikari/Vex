import { describe, expect, it } from "vitest";
import {
  messageCursorSchema,
  messageKindSchema,
  messagePageSchema,
  messageRoleSchema,
  messagesGetAroundInputSchema,
  messagesGetTailInputSchema,
  messagesListInputSchema,
  sessionMessageDtoSchema,
} from "../messages.js";

const ISO = "2026-05-21T10:00:00.000Z";
const SESSION = "00000000-0000-4000-8000-000000000001";

describe("messages schemas", () => {
  it("role + kind enums accept canonical values", () => {
    for (const r of ["system", "user", "assistant", "tool"]) {
      expect(messageRoleSchema.safeParse(r).success).toBe(true);
    }
    for (const k of ["text", "tool_call", "tool_result", "runtime_notice", "error"]) {
      expect(messageKindSchema.safeParse(k).success).toBe(true);
    }
  });

  it("rejects exotic role / kind", () => {
    expect(messageRoleSchema.safeParse("hacker").success).toBe(false);
    expect(messageKindSchema.safeParse("compaction").success).toBe(false);
  });

  it("sessionMessageDtoSchema parses a typical text row", () => {
    const parsed = sessionMessageDtoSchema.safeParse({
      id: 12,
      sessionId: SESSION,
      role: "assistant",
      kind: "text",
      content: "hello",
      createdAt: ISO,
      toolCallId: null,
      toolName: null,
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects DTO with extra fields (.strict)", () => {
    const parsed = sessionMessageDtoSchema.safeParse({
      id: 1,
      sessionId: SESSION,
      role: "user",
      kind: "text",
      content: "x",
      createdAt: ISO,
      toolCallId: null,
      toolName: null,
      metadata: { leaky: "value" },
    });
    expect(parsed.success).toBe(false);
  });

  it("messageCursorSchema requires datetime + positive int id", () => {
    expect(
      messageCursorSchema.safeParse({ createdAt: ISO, id: 7 }).success,
    ).toBe(true);
    expect(
      messageCursorSchema.safeParse({ createdAt: ISO, id: 0 }).success,
    ).toBe(false);
    expect(
      messageCursorSchema.safeParse({ createdAt: "yesterday", id: 1 }).success,
    ).toBe(false);
  });

  it("messagesGetTailInputSchema clamps limit to [1, 100] with default 50", () => {
    const parsed = messagesGetTailInputSchema.safeParse({ sessionId: SESSION });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.limit).toBe(50);

    expect(
      messagesGetTailInputSchema.safeParse({ sessionId: SESSION, limit: 0 })
        .success,
    ).toBe(false);
    expect(
      messagesGetTailInputSchema.safeParse({ sessionId: SESSION, limit: 101 })
        .success,
    ).toBe(false);
  });

  it("messagesListInputSchema defaults cursor to null", () => {
    const parsed = messagesListInputSchema.safeParse({ sessionId: SESSION });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.cursor).toBeNull();
      expect(parsed.data.limit).toBe(50);
    }
  });

  it("messagesGetAroundInputSchema requires positive messageId + clamps windows", () => {
    expect(
      messagesGetAroundInputSchema.safeParse({
        sessionId: SESSION,
        messageId: 0,
      }).success,
    ).toBe(false);
    expect(
      messagesGetAroundInputSchema.safeParse({
        sessionId: SESSION,
        messageId: 5,
        before: 60,
      }).success,
    ).toBe(false);
  });

  it("messagePageSchema validates wrapper shape", () => {
    const parsed = messagePageSchema.safeParse({
      items: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(parsed.success).toBe(true);
  });
});
