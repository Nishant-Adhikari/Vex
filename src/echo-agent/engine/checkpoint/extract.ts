/**
 * Episode extraction — the "episodes" leg of checkpoint.
 *
 * Separate provider call from `summarizePrefix`: we want summary to succeed
 * even if extraction misbehaves, and vice versa. Pipeline mirrors
 * `engine/mission/patch-parser.ts`: boundary `unknown → JSON → zod → narrow`.
 *
 * Multilingual contract (PR2, post-migration 008):
 *   - Output text (title, summary_text, facts, decisions, open_loops,
 *     tool_outcomes, entities) is in the session's language, not forced
 *     English. The language is inferred at the FIRST checkpoint (current
 *     code = null) and persisted to `sessions.memory_language_code` by the
 *     caller; subsequent checkpoints pass the persisted code back as
 *     `currentCode` and the prompt pins the language.
 *   - Each episode carries an LLM-generated `title` (≤ 100 chars, same
 *     language as summary_text). `title` is NOT part of `episode_hash` so
 *     retries producing different titles on the same summary still dedupe.
 *
 * Failure modes are non-blocking — both `JSON.parse` throw and schema
 * validation failure return an empty result with a warn log. Embedding
 * happens in the caller, not here.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import type { InferenceProvider, InferenceConfig } from "@echo-agent/inference/types.js";
import type { MessageWithId } from "@echo-agent/db/repos/messages.js";
import { EPISODE_KINDS, type EpisodeKind } from "@echo-agent/db/repos/session-episodes.js";
import logger from "@utils/logger.js";

/** Truncation cap for per-message content shown to the extractor. */
const PER_MESSAGE_CHAR_CAP = 800;

/** Max title length accepted from the LLM (truncated if longer). */
const TITLE_MAX_CHARS = 100;

/**
 * Accept BCP 47 subset aligned with `sessions.ts::LANG_CODE_RE`. Kept local
 * to avoid a circular import between extract.ts and sessions.ts. If the
 * repo-level regex changes, update this one too.
 */
const SESSION_LANG_RE = /^([a-z]{2,3}(-[A-Z]{2})?|und)$/;

export interface ExtractedEpisode {
  episodeKind: EpisodeKind;
  /** LLM-generated short title (≤100 chars), same language as summaryText. May be empty when the LLM omits it. */
  title: string;
  /** Episode summary in the session's language (renamed from summaryEn pre-PR2). */
  summaryText: string;
  facts: Record<string, unknown>;
  decisions: Record<string, unknown>;
  openLoops: Record<string, unknown>;
  entities: string[];
  toolOutcomes: Record<string, unknown>;
  /** sha256 of `episodeKind + '\n' + summaryText` — stable across retries; does NOT include title. */
  episodeHash: string;
}

export interface ExtractionResult {
  episodes: ExtractedEpisode[];
  /**
   * Language code the LLM inferred for this checkpoint. Empty string when
   * the LLM omitted the field or the regex rejected it. The caller persists
   * this to `sessions.memory_language_code` only on the first checkpoint
   * (when the current code is null) and ignores it otherwise.
   */
  sessionLanguageInferred: string;
}

// ── Schema ─────────────────────────────────────────────────────

const EpisodeSchema = z.object({
  episode_kind: z.enum(EPISODE_KINDS),
  // `title` is required by the contract but kept optional at the schema
  // level so a compliant LLM that occasionally omits it doesn't lose the
  // whole batch. Runtime in checkpoint.ts falls back to
  // `summary_text.slice(0, 120)` and logs a warn for compliance tracking.
  title: z.string().max(500).optional().default(""),
  summary_text: z.string().min(1).max(2000),
  facts: z.record(z.string(), z.unknown()).default({}),
  decisions: z.record(z.string(), z.unknown()).default({}),
  open_loops: z.record(z.string(), z.unknown()).default({}),
  entities: z.array(z.string()).max(50).default([]),
  tool_outcomes: z.record(z.string(), z.unknown()).default({}),
});

const ExtractionResultSchema = z.object({
  // Optional + default empty string so a lenient LLM omission doesn't kill
  // the whole batch. Callers handle "" as "LLM didn't tell us".
  session_language_inferred: z.string().optional().default(""),
  episodes: z.array(EpisodeSchema).max(20),
});

// ── Entry point ────────────────────────────────────────────────

export async function extractEpisodes(
  prefix: readonly MessageWithId[],
  provider: InferenceProvider,
  config: InferenceConfig,
  currentCode: string | null,
): Promise<ExtractionResult> {
  if (prefix.length === 0) {
    return { episodes: [], sessionLanguageInferred: "" };
  }

  const prompt = buildExtractionPrompt(prefix, currentCode);
  let raw: { content: string | null };
  try {
    raw = await provider.chatCompletionSimple(
      [{ role: "system", content: prompt }],
      config,
    );
  } catch (err) {
    logger.warn("checkpoint.extract.provider_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { episodes: [], sessionLanguageInferred: "" };
  }

  const text = raw.content ?? "";
  const parsed = parseJsonValue(text);
  if (parsed === null) {
    logger.warn("checkpoint.extract.json_parse_failed", {
      textPreview: text.slice(0, 120),
    });
    return { episodes: [], sessionLanguageInferred: "" };
  }

  const candidate = toResultCandidate(parsed);
  const result = ExtractionResultSchema.safeParse(candidate);
  if (!result.success) {
    logger.warn("checkpoint.extract.schema_invalid", {
      issueCount: result.error.issues.length,
      firstIssue: result.error.issues[0]?.message,
    });
    return { episodes: [], sessionLanguageInferred: "" };
  }

  // PR-11: Collect blob_keys from overflow rows in the prefix so episode
  // recall still resolves full tool payloads after compaction. The LLM may
  // not emit these in `tool_outcomes` naturally — we merge them in post.
  const overflowBlobKeys = collectOverflowBlobKeys(prefix);

  const episodes: ExtractedEpisode[] = result.data.episodes.map((ep) => {
    const summaryText = ep.summary_text.trim();
    const titleTrimmed = (ep.title ?? "").trim();
    if (titleTrimmed.length === 0) {
      logger.warn("checkpoint.extract.title_missing", {
        episodeKind: ep.episode_kind,
        summaryPreview: summaryText.slice(0, 60),
      });
    }
    // Truncate defensively in case the LLM ignored the ≤100 cap. Zod's
    // max(500) above is a sanity gate; this is the domain cap.
    const title = titleTrimmed.slice(0, TITLE_MAX_CHARS);
    const toolOutcomes = mergeOverflowBlobKeys(ep.tool_outcomes, ep.episode_kind, overflowBlobKeys);
    return {
      episodeKind: ep.episode_kind,
      title,
      summaryText,
      facts: ep.facts,
      decisions: ep.decisions,
      openLoops: ep.open_loops,
      entities: ep.entities,
      toolOutcomes,
      // Hash input is kind + summaryText ONLY — title is metadata and must
      // not destabilise dedupe when the LLM produces a different title on
      // retry against the same summary.
      episodeHash: computeEpisodeHash(ep.episode_kind, summaryText),
    };
  });

  // Validate the inferred language code at the boundary — if it doesn't
  // match the repo-wide regex, treat as absent so the caller skips the
  // persist step rather than writing garbage into memory_language_code.
  const rawInferred = (result.data.session_language_inferred ?? "").trim();
  const sessionLanguageInferred = SESSION_LANG_RE.test(rawInferred) ? rawInferred : "";
  if (rawInferred.length > 0 && sessionLanguageInferred === "") {
    logger.warn("checkpoint.extract.language_code_invalid", {
      received: rawInferred,
    });
  }

  return { episodes, sessionLanguageInferred };
}

/**
 * Stable hash used for dedupe when retrying extraction on the same prefix.
 * Exposed so the giant-tool synthetic fallback can build rows that collide
 * with a second attempt. Hashes `kind + '\n' + summaryText` — deliberately
 * does NOT include title.
 */
export function computeEpisodeHash(kind: EpisodeKind, summaryText: string): string {
  const h = createHash("sha256");
  h.update(kind);
  h.update("\n");
  h.update(summaryText);
  return h.digest("hex");
}

// ── Prompt ─────────────────────────────────────────────────────

function buildExtractionPrompt(
  prefix: readonly MessageWithId[],
  currentCode: string | null,
): string {
  const conversation = prefix
    .map((m) => `[${m.role}]: ${m.content.slice(0, PER_MESSAGE_CHAR_CAP)}`)
    .join("\n");

  return `You extract reusable episodic memory from a conversation prefix.

Output a single JSON object — no prose, no markdown fences. Shape:

${JSON_SHAPE}

${buildLanguageDirective(currentCode)}

For each episode emit a short \`title\` (<= 100 characters, same language as summary_text) that names the actual TOPIC of the episode — not the first sentence of summary_text, not metadata about the message. Examples:
- Good: "USDC balance check on Solana"
- Good: "Decision to hold ETH through drawdown"
- Bad: "User asked to check USDC balance" (quotes opening)
- Bad: "Agent reported tool call" (names metadata, not topic)

Only emit episodes that carry value across sessions. Skip chitchat, repeated instructions, and ephemeral state. Prefer concise self-contained facts over paragraphs. If nothing is worth saving, output { "session_language_inferred": "${currentCode ?? "und"}", "episodes": [] }.

Conversation prefix:
${conversation}`;
}

const JSON_SHAPE = `{
  "session_language_inferred": "<code: en | pl | fr | zh | vi | pt-BR | ... | und>",
  "episodes": [
    {
      "episode_kind": "decision" | "fact" | "preference" | "open_loop" | "tool_result_summary" | "lesson",
      "title": "short topic label (<= 100 characters)",
      "summary_text": "1-2 sentence summary (required, <= 2000 chars)",
      "facts": { /* arbitrary structured fields */ },
      "decisions": { /* arbitrary structured fields */ },
      "open_loops": { /* arbitrary structured fields */ },
      "entities": ["canonical names or ids"],
      "tool_outcomes": { "tool_name": "outcome summary" }
    }
  ]
}`;

function buildLanguageDirective(currentCode: string | null): string {
  if (currentCode === null) {
    return `LANGUAGE — first checkpoint (no code persisted yet):
Output all text values — in title, summary_text, facts, decisions, open_loops, tool_outcomes, and entities — in the dominant language of the archived conversation. Preserve the user's language naturally.

Additionally, infer the session's memory language and set \`session_language_inferred\` to a lowercase language code (e.g. "en", "pl", "fr", "zh", "vi") — or "und" for mixed / unclear. This value will be persisted and used for all future checkpoints of this session.`;
  }
  if (currentCode === "und") {
    return `LANGUAGE — session language is marked undetermined:
Output all text values (title, summary_text, facts, decisions, open_loops, tool_outcomes, entities) in the dominant language of this checkpoint's archived prefix — pick one and stay consistent within this output.

Set \`session_language_inferred\` to "und" (caller ignores it for existing sessions).`;
  }
  const languageName = languageNameFor(currentCode);
  return `LANGUAGE — session language is ${languageName} (code "${currentCode}"):
Output all text values in ${languageName}. Preserve this language for title, summary_text, facts, decisions, open_loops, tool_outcomes, and entities. Do not translate out of ${languageName}.

Set \`session_language_inferred\` to "${currentCode}" (confirms the persistent value; caller ignores it for existing sessions).`;
}

function languageNameFor(code: string): string {
  // Best-effort human label for the LLM prompt. Falls back to the raw code
  // when we don't have a mapping — the LLM still gets the code, just no
  // English nameplate.
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

// ── JSON parsing ───────────────────────────────────────────────

function parseJsonValue(text: string): unknown {
  const fenceMatch = text.match(/```json\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {
      // fall through to raw parse
    }
  }

  // Pick the outermost shape based on which delimiter comes FIRST. If the
  // response is a legacy bare array `[{...}]`, the brace path would otherwise
  // greedily pick the inner object and lose the array wrapping — so we let
  // the leading delimiter decide.
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");
  const preferBracket =
    firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace);

  if (preferBracket) {
    const lastBracket = text.lastIndexOf("]");
    if (firstBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(text.slice(firstBracket, lastBracket + 1));
      } catch {
        // fall through to brace attempt
      }
    }
  }

  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    } catch {
      // fall through
    }
  }

  // Last-chance bracket attempt (e.g. brace came first but the brace slice
  // was unparseable — try the outer bracket range if any).
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    try {
      return JSON.parse(text.slice(firstBracket, lastBracket + 1));
    } catch {
      return null;
    }
  }

  return null;
}

function toResultCandidate(raw: unknown): unknown {
  // New contract — object with `episodes` and `session_language_inferred`.
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.episodes)) {
      return {
        session_language_inferred: obj.session_language_inferred ?? "",
        episodes: obj.episodes,
      };
    }
  }
  // Legacy shape — bare array of episodes. Treat as "no language inferred"
  // and let the caller decide how to degrade.
  if (Array.isArray(raw)) {
    return { session_language_inferred: "", episodes: raw };
  }
  return { session_language_inferred: "", episodes: [] };
}

// ── Overflow blob propagation (PR-11) ──────────────────────────

/**
 * Scan the archived prefix for PR-11 overflow rows and collect every
 * `blob_key` that lived there. Tool-result-summary episodes (and, as a
 * fallback, the first episode) receive these keys under
 * `tool_outcomes.overflow_blob_keys` so recall after compaction still
 * points at the full payload.
 */
function collectOverflowBlobKeys(prefix: readonly MessageWithId[]): string[] {
  const keys: string[] = [];
  for (const m of prefix) {
    if (m.role !== "tool") continue;
    const payload = m.metadata?.payload as Record<string, unknown> | undefined;
    if (!payload || payload.overflow !== true) continue;
    const blobKey = typeof payload.blobKey === "string" ? payload.blobKey : null;
    if (blobKey) keys.push(blobKey);
  }
  return keys;
}

function mergeOverflowBlobKeys(
  toolOutcomes: Record<string, unknown>,
  episodeKind: EpisodeKind,
  blobKeys: readonly string[],
): Record<string, unknown> {
  if (blobKeys.length === 0) return toolOutcomes;
  // Attach only to tool_result_summary episodes — those are the ones that
  // canonically represent tool-call outcomes. Other episode kinds get the
  // keys only when they are the sole episode (nothing else to carry them).
  if (episodeKind !== "tool_result_summary") return toolOutcomes;
  return {
    ...toolOutcomes,
    overflow_blob_keys: [...blobKeys],
  };
}
