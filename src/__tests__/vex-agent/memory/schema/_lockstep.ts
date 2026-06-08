/**
 * Shared lockstep helpers for the memory-schema enum drift guards.
 *
 * Each bounded-vocab enum lives in TWO places that MUST stay identical: a named
 * CHECK constraint in `db/migrations/001_initial.sql` (the DB enforces it at
 * write time) and an `as const` tuple + `z.enum(...)` in a `memory/schema/*`
 * module (TS + import validation enforce it). These helpers parse the SQL CHECK
 * value lists so the per-enum tests can assert SQL == TS == Zod options.
 *
 * Extracted (S1c) from `memory-candidate-enums.test.ts` so the candidate,
 * job, and decision enum tests share ONE parser (rules/10 §17: 3+ uses → extract).
 *
 * The migration is read from the human-edited SOURCE file (not a build artifact)
 * so a stale `dist/` can never mask a drift in the source.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { getPackageRoot } from "@utils/package-assets.js";

/** Raw text of the source migration (the single source of truth for CHECKs). */
export const MIGRATION_SQL: string = readFileSync(
  join(getPackageRoot(), "src", "vex-agent", "db", "migrations", "001_initial.sql"),
  "utf-8",
);

/**
 * Extract the quoted value list from a named CHECK of the form
 * `CONSTRAINT <name> CHECK (<column> IN ('a','b',...))`. Throws if the
 * constraint is absent so a rename/removal fails loudly rather than silently
 * passing against an empty set.
 */
export function parseCheckInList(sql: string, constraintName: string, column: string): string[] {
  const re = new RegExp(
    `CONSTRAINT\\s+${constraintName}\\s+CHECK\\s*\\(\\s*${column}\\s+IN\\s*\\(([^)]*)\\)`,
    "i",
  );
  const match = re.exec(sql);
  if (!match) {
    throw new Error(
      `lockstep: named CHECK '${constraintName}' on column '${column}' not found in 001_initial.sql`,
    );
  }
  return match[1]!
    .split(",")
    .map((token) => token.trim().replace(/^'(.*)'$/, "$1"))
    .filter((token) => token.length > 0);
}

/** Order-independent set comparison via sorted copies. */
export function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}
