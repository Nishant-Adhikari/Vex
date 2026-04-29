/**
 * Session episode recall prompt block — sync formatter.
 *
 * Distinct from Active Knowledge. Episodes are ephemeral per-scope memories
 * produced by checkpoints; knowledge entries are canonical curated wisdom.
 * They get SEPARATE blocks so the model doesn't conflate the two.
 *
 * Emitted as its own `role:'system'` message in `buildProviderMessages`, AFTER
 * the rolling summary and BEFORE the live message history. Uses the same
 * truncate / char-cap shape as `prompts/knowledge.ts`.
 */

import type { RecallHit } from "@vex-agent/db/repos/session-episodes.js";

export const SESSION_MEMORY_MAX_ITEMS = 5;
export const SESSION_MEMORY_SUMMARY_TRUNCATE = 240;
export const SESSION_MEMORY_TOTAL_CHARS_CAP = 2_000;

export interface SessionMemoryCaps {
  maxItems?: number;
  summaryTruncate?: number;
  totalCharsCap?: number;
}

/**
 * Render a bounded session-episode recall block.
 *
 * Returns `""` when there is nothing to show so the caller can omit the
 * system block entirely — never emit an empty heading.
 */
export function formatSessionEpisodeRecallBlock(
  hits: readonly RecallHit[],
  caps: SessionMemoryCaps = {},
): string {
  if (hits.length === 0) return "";

  const maxItems = caps.maxItems ?? SESSION_MEMORY_MAX_ITEMS;
  const summaryTruncate = caps.summaryTruncate ?? SESSION_MEMORY_SUMMARY_TRUNCATE;
  const totalCharsCap = caps.totalCharsCap ?? SESSION_MEMORY_TOTAL_CHARS_CAP;

  const lines: string[] = [];
  lines.push("[Session episode recall]");
  lines.push(
    "Relevant episodes from prior checkpoints (same memory scope). Use as context, not ground truth.",
  );

  let charsUsed = 0;
  const capped = hits.slice(0, maxItems);
  for (const hit of capped) {
    const line = formatHit(hit, summaryTruncate);
    if (charsUsed + line.length > totalCharsCap) break;
    lines.push(line);
    charsUsed += line.length;
  }

  // If only the heading+preamble survived (everything clipped by total cap),
  // drop the whole block rather than emit a useless shell.
  if (lines.length <= 2) return "";
  return lines.join("\n");
}

function formatHit(hit: RecallHit, summaryTruncate: number): string {
  const { episode, similarity } = hit;
  // Prefer the LLM-generated title (PR2, post-migration 008) as a short
  // header; fall back to the truncated summary alone for legacy rows where
  // title was left empty. Keeping both avoids an unbalanced render when the
  // title is missing.
  const truncated = truncate(episode.summaryText, summaryTruncate);
  const header = episode.title.trim().length > 0 ? `${episode.title}: ` : "";
  const session = episode.sourceSession ?? "—";
  // PR-8: surface recency so the model can distinguish fresh vs stale context
  // at a glance. `gen:N` = checkpoint generation stamp; null on legacy rows.
  // `created:YYYY-MM-DD` = ISO date slice (time-of-day is noisy for recall).
  // `!= null` deliberately catches both null (row stamped pre-PR-8) and
  // undefined (test fixtures that omit the field). The format string below
  // would otherwise render `gen:undefined`.
  const genFragment = episode.checkpointGeneration != null
    ? `gen:${episode.checkpointGeneration}, `
    : "";
  const createdDate = formatIsoDate(episode.createdAt);
  return `- [${episode.episodeKind}] ${header}${truncated} (session:${session}, ${genFragment}created:${createdDate}, sim:${similarity.toFixed(2)})`;
}

function formatIsoDate(iso: string): string {
  // pg timestamptz arrives as an ISO8601 string; slice(0, 10) = YYYY-MM-DD.
  // Defensive fallback keeps formatting lossless when the caller passes
  // something unexpected (test fixtures, manual inserts).
  if (iso.length >= 10 && iso.charAt(4) === "-" && iso.charAt(7) === "-") {
    return iso.slice(0, 10);
  }
  const parsed = new Date(iso);
  if (Number.isFinite(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return iso;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}
