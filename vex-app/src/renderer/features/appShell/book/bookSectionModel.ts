/**
 * BOOK rail section model — the canonical set + ordering rules for the right
 * panel's reorderable MISSION CONTROL instrument sections.
 *
 * POSITION is deliberately NOT in this set: it moved to the LEFT sidebar (its
 * own always-present accordion). The right rail is the run's instruments only —
 * MOVES, RUNTIME & COST, SESSION — plus the fixed MISSION CONTROL run-status
 * header and the conditional Hyperliquid blocks, which are not user-reorderable.
 *
 * The persisted order (`uiStore.bookSectionOrder`) is user-writable and can go
 * stale across releases (a section added/removed), so it is never trusted
 * verbatim: `resolveBookSectionOrder` projects it onto the canonical set —
 * keeping the user's relative order, dropping ids we no longer render, and
 * appending any canonical id the payload is missing so a new section always
 * appears (at the end) instead of silently vanishing.
 */

export const BOOK_SECTION_IDS = ["moves", "runtime", "session"] as const;
export type BookSectionId = (typeof BOOK_SECTION_IDS)[number];

export const BOOK_SECTION_TITLES: Readonly<Record<BookSectionId, string>> = {
  moves: "Moves",
  runtime: "Runtime & Cost",
  session: "Session",
};

/**
 * Reconcile a persisted/edited order against the canonical section set.
 * Fail-soft: unknown ids are dropped, duplicates collapsed, and any missing
 * canonical id is appended in canonical order so every section renders exactly
 * once. An empty or garbage input yields the canonical default order.
 */
export function resolveBookSectionOrder(
  order: readonly string[],
): readonly BookSectionId[] {
  const known = new Set<string>(BOOK_SECTION_IDS);
  const seen = new Set<BookSectionId>();
  const resolved: BookSectionId[] = [];
  for (const id of order) {
    if (known.has(id) && !seen.has(id as BookSectionId)) {
      resolved.push(id as BookSectionId);
      seen.add(id as BookSectionId);
    }
  }
  for (const id of BOOK_SECTION_IDS) {
    if (!seen.has(id)) resolved.push(id);
  }
  return resolved;
}
