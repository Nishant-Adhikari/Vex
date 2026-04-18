/**
 * Rolling summary merge — the "summary" leg of checkpoint.
 *
 * Unlike the old full-archive path, we pass the PREVIOUS summary into the
 * compaction call so nothing said before the current prefix is dropped on the
 * floor. The prompt instructs the model to MERGE, not replace — preserving
 * decisions, tool outcomes, and pending actions across successive checkpoints.
 *
 * Multilingual contract (PR2, post-migration 008):
 *   The summary is produced in the session's language, not forced English.
 *   The caller passes the persisted `sessions.memory_language_code` as
 *   `currentCode`; the prompt pins the output language. For the very first
 *   checkpoint (`currentCode === null`) or sessions marked `"und"`, the
 *   summarizer picks the dominant language of the archived prefix.
 */

import type { InferenceProvider, InferenceConfig } from "@echo-agent/inference/types.js";
import type { MessageWithId } from "@echo-agent/db/repos/messages.js";

/** Truncation cap for per-message content shown to the summarizer. */
const PER_MESSAGE_CHAR_CAP = 500;

export async function summarizePrefix(
  prefix: readonly MessageWithId[],
  previousSummary: string | null,
  provider: InferenceProvider,
  config: InferenceConfig,
  currentCode: string | null,
): Promise<string> {
  if (prefix.length === 0) {
    throw new Error("summarizePrefix: prefix must be non-empty");
  }

  const compactionPrompt = buildCompactionPrompt(prefix, previousSummary, currentCode);
  const { content: summary } = await provider.chatCompletionSimple(
    [{ role: "system", content: compactionPrompt }],
    config,
  );

  const trimmed = summary?.trim();
  if (!trimmed) {
    throw new Error("summarizePrefix: provider returned empty summary");
  }
  return trimmed;
}

// ── Prompt builder ─────────────────────────────────────────────

function buildCompactionPrompt(
  prefix: readonly MessageWithId[],
  previousSummary: string | null,
  currentCode: string | null,
): string {
  const conversation = prefix
    .map((m) => `[${m.role}]: ${m.content.slice(0, PER_MESSAGE_CHAR_CAP)}`)
    .join("\n");

  const previousBlock = previousSummary
    ? `Previous rolling summary (carry forward what's still relevant):\n${previousSummary}\n\n`
    : "";

  return `You are a conversation summarizer. Produce a single rolling summary that MERGES the previous summary (if any) with the newly archived prefix below. Preserve across checkpoints:
- Key decisions made
- Tool calls executed and their results
- Current state of any ongoing mission or task
- Important data points (balances, prices, positions)
- Any pending actions or next steps

Drop superseded details. Do not re-output the previous summary verbatim — integrate it. Output plain text, no preamble.

${buildLanguageDirective(currentCode)}

${previousBlock}Archived prefix:
${conversation}`;
}

function buildLanguageDirective(currentCode: string | null): string {
  if (currentCode === null || currentCode === "und") {
    return "Output in the dominant language of the archived conversation — preserve the user's language naturally. If the previous summary (above) is in a different language than the archived prefix, align the merged output with the archived prefix's language.";
  }
  const languageName = languageNameFor(currentCode);
  return `Output in ${languageName}. Preserve this language across the entire summary — do not translate out of ${languageName}. If the previous summary or archived prefix mixes other languages, normalise to ${languageName}.`;
}

function languageNameFor(code: string): string {
  const primary = code.split("-")[0]!;
  const map: Record<string, string> = {
    en: "English",
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
  const name = map[primary];
  if (!name) return `the language with code "${code}"`;
  return code.includes("-") ? `${name} (${code})` : name;
}
