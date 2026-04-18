/**
 * Prompt assertions for episode extraction.
 *
 * Post-PR2 (migration 008) the extraction prompt is conditional on the
 * session's persisted `memory_language_code`:
 *   - null     → first checkpoint; LLM picks dominant language AND infers code
 *   - "en"/"pl"/... → subsequent checkpoint; LLM pinned to that language
 *   - "und"    → session marked mixed/unclear; LLM picks dominant per-prefix
 *
 * Every variant requires the LLM to emit `title` per episode and
 * `session_language_inferred` at the batch level. The English-only
 * invariant from pre-PR2 is gone — knowledge entries stay English-only
 * (PR4 promotion boundary), but session memory is multilingual.
 */

import { describe, it, expect, vi } from "vitest";

import { extractEpisodes } from "@echo-agent/engine/checkpoint/extract.js";
import type { MessageWithId } from "@echo-agent/db/repos/messages.js";

function msg(id: number, role: MessageWithId["role"], content: string): MessageWithId {
  return {
    id,
    role,
    content,
    timestamp: `2026-04-17T00:00:${String(id).padStart(2, "0")}Z`,
  };
}

async function captureExtractPrompt(
  currentCode: string | null,
  messages: MessageWithId[] = [msg(1, "user", "hello"), msg(2, "assistant", "hi")],
): Promise<string> {
  const seen: Array<{ role: string; content: string }> = [];
  const provider = {
    chatCompletionSimple: vi.fn().mockImplementation(async (sent: Array<{ role: string; content: string }>) => {
      seen.push(...sent);
      return {
        content: JSON.stringify({ session_language_inferred: "en", episodes: [] }),
        usage: {},
      };
    }),
  };
  await extractEpisodes(messages, provider as never, {} as never, currentCode);
  expect(seen).toHaveLength(1);
  return seen[0].content;
}

describe("extractEpisodes prompt", () => {
  it("first checkpoint (currentCode=null): LLM infers language and tags every field", async () => {
    const prompt = await captureExtractPrompt(null);

    // No legacy English-only wording.
    expect(prompt).not.toMatch(/must be in english/i);

    // First-checkpoint directive — infer language, persist across session.
    expect(prompt).toMatch(/dominant language of the archived conversation/i);
    expect(prompt).toMatch(/infer the session['’]s memory language/i);
    expect(prompt).toMatch(/session_language_inferred/);

    // Title directive present with good/bad examples.
    expect(prompt).toMatch(/title.*100 characters/is);
    expect(prompt).toMatch(/Good:/);
    expect(prompt).toMatch(/Bad:/);

    // JSON shape mentions both new fields.
    expect(prompt).toMatch(/"title"/);
    expect(prompt).toMatch(/"summary_text"/);
    expect(prompt).toMatch(/"session_language_inferred"/);
  });

  it("explicit code (pl): prompt pins output to Polish and confirms the code", async () => {
    const prompt = await captureExtractPrompt("pl");
    expect(prompt).toMatch(/Output all text values in Polish/);
    expect(prompt).toMatch(/Do not translate out of Polish/);
    expect(prompt).toMatch(/"pl"/); // confirms the persistent value
  });

  it("explicit code (fr): prompt pins output to French", async () => {
    const prompt = await captureExtractPrompt("fr");
    expect(prompt).toMatch(/Output all text values in French/);
    expect(prompt).toMatch(/"fr"/);
  });

  it("und code: prompt tells LLM to pick dominant language per checkpoint", async () => {
    const prompt = await captureExtractPrompt("und");
    expect(prompt).toMatch(/session language is marked undetermined/i);
    expect(prompt).toMatch(/dominant language of this checkpoint['’]s archived prefix/i);
    expect(prompt).toMatch(/"und"/);
  });

  it("unknown language code falls back to the raw code in the directive", async () => {
    const prompt = await captureExtractPrompt("xx");
    // We don't have a human name for "xx" — the directive still references it.
    expect(prompt).toMatch(/"xx"/);
  });
});

describe("extractEpisodes output parsing", () => {
  it("accepts the new {session_language_inferred, episodes} shape", async () => {
    const provider = {
      chatCompletionSimple: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          session_language_inferred: "pl",
          episodes: [
            {
              episode_kind: "fact",
              title: "USDC balance check",
              summary_text: "User checked USDC balance on Solana: 1250 USDC.",
              facts: { amount: 1250 },
              decisions: {},
              open_loops: {},
              entities: ["USDC"],
              tool_outcomes: {},
            },
          ],
        }),
        usage: {},
      }),
    };

    const result = await extractEpisodes(
      [msg(1, "user", "jaki mam balans")],
      provider as never,
      {} as never,
      null,
    );

    expect(result.sessionLanguageInferred).toBe("pl");
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0].title).toBe("USDC balance check");
    expect(result.episodes[0].summaryText).toContain("USDC");
    // Hash covers kind + summaryText only (title-independent).
    expect(result.episodes[0].episodeHash).toHaveLength(64);
  });

  it("logs a warn and returns empty title when LLM omits it", async () => {
    const provider = {
      chatCompletionSimple: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          session_language_inferred: "en",
          episodes: [
            {
              episode_kind: "fact",
              summary_text: "A fact without a title.",
              facts: {},
              decisions: {},
              open_loops: {},
              entities: [],
              tool_outcomes: {},
            },
          ],
        }),
        usage: {},
      }),
    };

    const result = await extractEpisodes(
      [msg(1, "user", "x")],
      provider as never,
      {} as never,
      null,
    );
    expect(result.episodes).toHaveLength(1);
    expect(result.episodes[0].title).toBe("");
  });

  it("rejects invalid session_language_inferred at the boundary (returns empty string)", async () => {
    const provider = {
      chatCompletionSimple: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          session_language_inferred: "GARBAGE!",
          episodes: [],
        }),
        usage: {},
      }),
    };

    const result = await extractEpisodes(
      [msg(1, "user", "x")],
      provider as never,
      {} as never,
      null,
    );
    expect(result.sessionLanguageInferred).toBe("");
  });

  it("legacy bare-array response is accepted with empty language", async () => {
    const provider = {
      chatCompletionSimple: vi.fn().mockResolvedValue({
        content: JSON.stringify([
          {
            episode_kind: "fact",
            title: "Legacy fact",
            summary_text: "A fact from legacy shape.",
            facts: {},
            decisions: {},
            open_loops: {},
            entities: [],
            tool_outcomes: {},
          },
        ]),
        usage: {},
      }),
    };

    const result = await extractEpisodes(
      [msg(1, "user", "x")],
      provider as never,
      {} as never,
      null,
    );
    expect(result.sessionLanguageInferred).toBe("");
    expect(result.episodes).toHaveLength(1);
  });

  it("computeEpisodeHash is stable across title changes for the same summary", async () => {
    const makeResponse = (title: string) =>
      JSON.stringify({
        session_language_inferred: "en",
        episodes: [
          {
            episode_kind: "fact",
            title,
            summary_text: "A stable summary.",
            facts: {},
            decisions: {},
            open_loops: {},
            entities: [],
            tool_outcomes: {},
          },
        ],
      });

    const a = await extractEpisodes(
      [msg(1, "user", "x")],
      { chatCompletionSimple: vi.fn().mockResolvedValue({ content: makeResponse("Title A"), usage: {} }) } as never,
      {} as never,
      null,
    );
    const b = await extractEpisodes(
      [msg(1, "user", "x")],
      { chatCompletionSimple: vi.fn().mockResolvedValue({ content: makeResponse("Title B"), usage: {} }) } as never,
      {} as never,
      null,
    );
    expect(a.episodes[0].episodeHash).toBe(b.episodes[0].episodeHash);
  });
});
