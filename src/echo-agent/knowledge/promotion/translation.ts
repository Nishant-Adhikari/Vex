/**
 * Translation boundary for promotion — the ONLY place in echo-agent that
 * translates session-language memory into English before it enters the
 * canonical knowledge layer.
 *
 * Non-recall hot path: promotion runs after checkpoint commit (best
 * effort) — a provider outage skips the candidate, it does not crash
 * the engine. See `knowledge/promotion.ts` orchestrator + `turn-loop.ts`
 * for the surrounding error handling.
 */

import type {
  InferenceConfig,
  InferenceProvider,
} from "@echo-agent/inference/types.js";

/**
 * Translate an episode's title + summary to English via the same provider
 * the engine uses. Returns both fields trimmed. Throws on provider error
 * or empty content.
 */
export async function translateEpisodeToEnglish(
  title: string,
  summary: string,
  langCode: string,
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<{ title: string; summary: string }> {
  const systemPrompt = `You are a translation tool. Translate the input from ${humanLangName(langCode)} to English. Output ONLY a valid JSON object with exactly two fields: "title" (<= 100 chars) and "summary" (the translated body). No preamble, no markdown fences, no commentary. Preserve proper nouns, numbers, tickers, chain/protocol names, and transaction hashes verbatim.`;
  const userPayload = JSON.stringify({ title, summary });

  const { content } = await provider.chatCompletionSimple(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPayload },
    ],
    config,
  );

  const parsed = parseTranslationResponse(content);
  if (parsed === null) {
    throw new Error(
      `translation failed: provider returned malformed JSON (preview: ${(content ?? "").slice(0, 120)})`,
    );
  }
  const translatedTitle = parsed.title.trim();
  const translatedSummary = parsed.summary.trim();
  if (translatedSummary.length === 0) {
    throw new Error("translation failed: empty summary");
  }
  return { title: translatedTitle, summary: translatedSummary };
}

function parseTranslationResponse(
  raw: string | null,
): { title: string; summary: string } | null {
  if (!raw) return null;
  const stripped = stripCodeFence(raw.trim());
  const firstBrace = stripped.indexOf("{");
  const lastBrace = stripped.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace <= firstBrace) return null;
  try {
    const obj = JSON.parse(stripped.slice(firstBrace, lastBrace + 1)) as {
      title?: unknown;
      summary?: unknown;
    };
    const title = typeof obj.title === "string" ? obj.title : "";
    const summary = typeof obj.summary === "string" ? obj.summary : "";
    if (!summary) return null;
    return { title, summary };
  } catch {
    return null;
  }
}

function stripCodeFence(s: string): string {
  const match = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  return match ? match[1]!.trim() : s;
}

function humanLangName(code: string): string {
  const primary = code.split("-")[0]!;
  const map: Record<string, string> = {
    pl: "Polish",
    fr: "French",
    zh: "Chinese",
    vi: "Vietnamese",
    es: "Spanish",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ja: "Japanese",
    ko: "Korean",
    ru: "Russian",
    ar: "Arabic",
    nl: "Dutch",
    uk: "Ukrainian",
    tr: "Turkish",
  };
  return map[primary] ?? `the language with code "${code}"`;
}
