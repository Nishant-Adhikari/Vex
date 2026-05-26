/**
 * Pure mapping tests for `toTranscriptRow` (stage 8-1). Locks the role+kind →
 * variant rules and the tool-name label fallback.
 */

import { describe, expect, it } from "vitest";
import type {
  MessageKind,
  MessageRole,
  SessionMessageDto,
} from "@shared/schemas/messages.js";
import { toTranscriptRow } from "../transcriptRowModel.js";

function dto(p: {
  readonly role: MessageRole;
  readonly kind: MessageKind;
  readonly content?: string;
  readonly toolName?: string | null;
}): SessionMessageDto {
  return {
    id: 1,
    sessionId: "00000000-0000-4000-8000-000000000001",
    role: p.role,
    kind: p.kind,
    content: p.content ?? "x",
    createdAt: "2026-05-26T10:00:00.000Z",
    toolCallId: null,
    toolName: p.toolName ?? null,
  };
}

describe("toTranscriptRow", () => {
  it("maps a user text message to the user variant (no label)", () => {
    const row = toTranscriptRow(dto({ role: "user", kind: "text", content: "hi" }));
    expect(row.variant).toBe("user");
    expect(row.label).toBeNull();
    expect(row.content).toBe("hi");
  });

  it("maps assistant text → assistant, system text → notice", () => {
    expect(toTranscriptRow(dto({ role: "assistant", kind: "text" })).variant).toBe(
      "assistant",
    );
    expect(toTranscriptRow(dto({ role: "system", kind: "text" })).variant).toBe(
      "notice",
    );
  });

  it("maps tool-role text to the tool variant with the tool-name label", () => {
    const row = toTranscriptRow(
      dto({ role: "tool", kind: "text", toolName: "polymarket:order" }),
    );
    expect(row.variant).toBe("tool");
    expect(row.label).toBe("polymarket:order");
  });

  it("maps tool_call / tool_result kinds to the tool variant regardless of role", () => {
    expect(
      toTranscriptRow(dto({ role: "assistant", kind: "tool_call", toolName: "swap" }))
        .variant,
    ).toBe("tool");
    expect(
      toTranscriptRow(dto({ role: "tool", kind: "tool_result" })).variant,
    ).toBe("tool");
  });

  it("falls back to a 'tool' label when a tool row has no toolName", () => {
    expect(
      toTranscriptRow(dto({ role: "assistant", kind: "tool_call", toolName: null }))
        .label,
    ).toBe("tool");
  });

  it("maps runtime_notice and error kinds to the notice variant", () => {
    expect(
      toTranscriptRow(dto({ role: "assistant", kind: "runtime_notice" })).variant,
    ).toBe("notice");
    expect(toTranscriptRow(dto({ role: "system", kind: "error" })).variant).toBe(
      "notice",
    );
  });

  it("maps the compaction kind to the compaction variant (no label) (8-4)", () => {
    const row = toTranscriptRow(
      dto({
        role: "system",
        kind: "compaction",
        content: "compacted · checkpoint 2",
      }),
    );
    expect(row.variant).toBe("compaction");
    expect(row.label).toBeNull();
    expect(row.content).toBe("compacted · checkpoint 2");
  });

  it("maps the recall kind to the recall variant carrying the tool name as label (8-4)", () => {
    expect(
      toTranscriptRow(
        dto({ role: "assistant", kind: "recall", toolName: "memory_recall" }),
      ).variant,
    ).toBe("recall");
    expect(
      toTranscriptRow(
        dto({ role: "assistant", kind: "recall", toolName: "knowledge_recall" }),
      ).label,
    ).toBe("knowledge_recall");
    // A recall row with no tool name keeps a null label (neutral marker copy).
    expect(
      toTranscriptRow(dto({ role: "assistant", kind: "recall", toolName: null }))
        .label,
    ).toBeNull();
  });
});
