/**
 * Prompt assertions for the rolling-summary merge step.
 *
 * Post-PR2 (migration 008) the summarizer output language is conditional on
 * the session's persisted `memory_language_code`:
 *   - null / "und" → picks dominant language of the archived conversation
 *   - "en" / "pl" / ... → pinned to that language
 *
 * The pre-PR2 English-only invariant is gone. Session memory (summary +
 * episodes) is multilingual; knowledge entries stay English-only and
 * translation happens at promotion (PR4), not per-turn.
 */

import { describe, it, expect, vi } from "vitest";

import { summarizePrefix } from "@vex-agent/engine/checkpoint/merge.js";
import type { MessageWithId } from "@vex-agent/db/repos/messages.js";

function msg(id: number, role: MessageWithId["role"], content: string): MessageWithId {
  return {
    id,
    role,
    content,
    timestamp: `2026-04-17T00:00:${String(id).padStart(2, "0")}Z`,
  };
}

async function captureSummarizePrompt(currentCode: string | null): Promise<string> {
  const seen: Array<{ role: string; content: string }> = [];
  const provider = {
    chatCompletionSimple: vi.fn().mockImplementation(async (messages: Array<{ role: string; content: string }>) => {
      seen.push(...messages);
      return { content: "summary", usage: {} };
    }),
  };
  await summarizePrefix(
    [msg(1, "user", "cześć"), msg(2, "assistant", "hi")],
    null,
    provider as never,
    {} as never,
    currentCode,
  );
  expect(seen).toHaveLength(1);
  expect(seen[0].role).toBe("system");
  return seen[0].content;
}

describe("summarizePrefix prompt", () => {
  it("null currentCode: picks dominant language of the archived conversation", async () => {
    const prompt = await captureSummarizePrompt(null);
    expect(prompt).not.toMatch(/output in english/i);
    expect(prompt).toMatch(/dominant language of the archived conversation/i);
  });

  it("explicit en code: pins output to English", async () => {
    const prompt = await captureSummarizePrompt("en");
    expect(prompt).toMatch(/Output in English/);
    expect(prompt).toMatch(/do not translate out of English/i);
  });

  it("explicit pl code: pins output to Polish", async () => {
    const prompt = await captureSummarizePrompt("pl");
    expect(prompt).toMatch(/Output in Polish/);
    expect(prompt).toMatch(/do not translate out of Polish/i);
  });

  it("und code: picks dominant language per checkpoint (same path as null)", async () => {
    const prompt = await captureSummarizePrompt("und");
    expect(prompt).toMatch(/dominant language of the archived conversation/i);
  });

  it("unknown code: falls back to referencing the raw code", async () => {
    const prompt = await captureSummarizePrompt("xx");
    expect(prompt).toMatch(/"xx"/);
  });
});
