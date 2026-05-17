/**
 * Theme slug validation for session memory chunks.
 *
 * A `theme` is the retrieval label attached to a `session_memories` row. It is
 * NOT a closed taxonomy (no enum), but degenerate slugs ("debug", "session",
 * "mission") would make recall useless because every chunk would cluster on
 * the same low-information label. This module rejects those.
 *
 * Rules (defined here so the chunker prompt + post-LLM validation share one
 * source of truth):
 *   - lowercase alphanumeric tokens joined by underscores
 *   - 3 to 8 tokens total
 *   - no token is a standalone stoplist entry (e.g. `debug` alone is bad,
 *     `kyber_quote_debug` is fine)
 *   - first token is alphabetic (no leading digit)
 *
 * Structured fields (`entities`, `protocols`, `error_classes`, `chains`,
 * `tasks`) carry orthogonal discriminators. Theme validation does NOT
 * cross-check those — that's the chunker's job at emission time.
 */

import { THEME_REGEX, THEME_STOPLIST_STANDALONE } from "./policy.js";

export type ThemeValidationOutcome =
  | { ok: true; theme: string }
  | { ok: false; reason: ThemeRejectionReason; theme: string };

export type ThemeRejectionReason =
  | "empty"
  | "not_string"
  | "too_short"
  | "shape_invalid"
  | "standalone_stopword";

export function validateTheme(input: unknown): ThemeValidationOutcome {
  if (typeof input !== "string") {
    return { ok: false, reason: "not_string", theme: String(input ?? "") };
  }

  const theme = input.trim();
  if (theme.length === 0) {
    return { ok: false, reason: "empty", theme };
  }

  const tokens = theme.split("_");
  if (tokens.length < 3) {
    return { ok: false, reason: "too_short", theme };
  }

  if (!THEME_REGEX.test(theme)) {
    return { ok: false, reason: "shape_invalid", theme };
  }

  // A single-token theme would have already been rejected by length check;
  // but a degenerate single-token *meaning* (e.g. "the_debug_session") is
  // caught by checking the most-meaningful tokens against the stoplist.
  // Heuristic: reject if EVERY non-trivial token is in the stoplist.
  const nonTrivial = tokens.filter((t) => t.length >= 3);
  const allStop = nonTrivial.length > 0
    && nonTrivial.every((t) => THEME_STOPLIST_STANDALONE.has(t));
  if (allStop) {
    return { ok: false, reason: "standalone_stopword", theme };
  }

  return { ok: true, theme };
}

/**
 * Generate a safe fallback theme from structured fields when the chunker
 * emits a degenerate slug. Composition priority:
 *   - First entity/protocol/error_class + first task → `<entity>_<task>`
 *   - If task missing: `<entity>_<chain>_observation`
 *   - If everything empty: `unclassified_chunk_<generation>`
 *
 * Returned theme is always validated; if it would still fail, the function
 * appends a counter suffix.
 */
export function buildFallbackTheme(opts: {
  entities: readonly string[];
  protocols: readonly string[];
  errorClasses: readonly string[];
  chains: readonly string[];
  tasks: readonly string[];
  generation: number;
}): string {
  const leadEntity = pickFirstSlug([
    ...opts.entities,
    ...opts.protocols,
    ...opts.errorClasses,
  ]);
  const leadTask = pickFirstSlug(opts.tasks);
  const leadChain = pickFirstSlug(opts.chains);

  let candidate = "unclassified_chunk";
  if (leadEntity && leadTask) {
    candidate = `${leadEntity}_${leadTask}_observation`;
  } else if (leadEntity && leadChain) {
    candidate = `${leadEntity}_${leadChain}_observation`;
  } else if (leadEntity) {
    candidate = `${leadEntity}_observation_chunk`;
  } else {
    candidate = `unclassified_observation_chunk`;
  }

  const validated = validateTheme(candidate);
  if (validated.ok) return validated.theme;

  // Last resort: pad with generation suffix to ensure length + uniqueness.
  return `unclassified_observation_gen_${opts.generation}`;
}

/**
 * Normalise any free-form text into a slug-safe token. Lowercase, ascii-only,
 * underscores between groups. Returns "" if the result would be empty.
 */
function pickFirstSlug(items: readonly string[]): string {
  for (const item of items) {
    const slug = toSlugToken(item);
    if (slug.length >= 2 && !THEME_STOPLIST_STANDALONE.has(slug)) return slug;
  }
  return "";
}

function toSlugToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}
