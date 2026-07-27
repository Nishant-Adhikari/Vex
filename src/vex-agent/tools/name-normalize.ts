/**
 * Separator-insensitive tool-name normalization.
 *
 * The model that drives a mission emits tool calls whose NAME sometimes
 * diverges from our canonical id by separator only: it swaps the canonical
 * dot for an underscore (`dexscreener_search` for `dexscreener.search`) —
 * OpenAI-style function names cannot contain dots, and every internal tool the
 * model sees uses snake_case, so a weak model "corrects" the dotted protocol
 * toolIds it reads out of discovery results into underscores. Before this
 * helper, such a call dead-ended at "Unknown tool" and the mission stopped
 * with zero trades.
 *
 * `normalizeToolName` collapses every run of `.`, `_`, or `-` into a single
 * `_` and lowercases, so `dexscreener.search`, `dexscreener_search`, and
 * `DexScreener__Search` all map to the SAME key. `buildNormalizedNameIndex`
 * builds a `normalized -> canonical` lookup and is COLLISION-SAFE: if two
 * distinct canonical ids normalize to the same key the key is dropped entirely
 * (never silently resolved to one of them) and a warning is logged. Exact-match
 * lookup upstream is therefore always the authority; the normalized index is a
 * fallback that only ever fires when it is unambiguous.
 */

import logger from "@utils/logger.js";

/** Lowercase and collapse `.`/`_`/`-` runs to a single `_` (trimmed). */
export function normalizeToolName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Build a `normalize(id) -> id` index over `ids`. Keys that more than one
 * distinct id normalizes to are AMBIGUOUS and are omitted from the returned
 * map (a warning is logged once per colliding key), so a normalized lookup can
 * never silently pick the wrong canonical id.
 */
export function buildNormalizedNameIndex(
  ids: Iterable<string>,
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  const collided = new Set<string>();

  for (const id of ids) {
    const key = normalizeToolName(id);
    const existing = index.get(key);
    if (existing !== undefined) {
      if (existing === id) continue; // duplicate id — harmless
      collided.add(key);
      logger.warn("tools.name_normalize.collision", { key, ids: [existing, id] });
      continue;
    }
    index.set(key, id);
  }

  // Ambiguous keys resolve to nothing — exact match stays the sole authority.
  for (const key of collided) index.delete(key);

  return index;
}
