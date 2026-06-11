/**
 * Cause-code extraction — the shared diagnostics primitive for the error
 * diagnostics phase (docs/error-diagnostics-plan.md §1 D-EXTRACT).
 *
 * Network/TLS failures (Node `net`/`tls`/undici, SDK transport wrappers)
 * bury the actionable errno (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`, `ENOTFOUND`,
 * `ECONNREFUSED`, …) somewhere down the `.cause` chain — the depth varies per
 * Node version and per wrapper, so callers must never assume
 * `.cause.cause.code`. This module walks the full chain and returns the FIRST
 * errno-shaped `.code` string it finds.
 *
 * Security contract (plan §0): the returned value is ONLY ever a string that
 * matches the closed errno shape below — message text, bodies, headers, or
 * any other free-form field are NEVER read or returned. Numeric `code`
 * values (provider error codes — a different dictionary, already handled
 * elsewhere) are ignored.
 *
 * Consumed by BOTH trees: vex-app main imports it via the `@vex-lib` alias,
 * the agent runtime via a relative path like the rest of `src/lib`.
 */

/**
 * Errno-shaped code: uppercase start, then uppercase/digits/underscores,
 * 3-60 chars total. Excludes sentences (no spaces), lowercase prose, and
 * trivially short strings, so no user data or message text can match.
 */
const ERRNO_SHAPE = /^[A-Z][A-Z0-9_]{2,59}$/;

/** Bound on the `.cause` walk — errno depth varies but stays shallow. */
const MAX_CAUSE_DEPTH = 6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * Depth-bounded, cycle-safe walk. Reads only `code` (own or inherited),
 * `cause`, and — as a fallback — the first entry of an `errors` array
 * (`AggregateError`, e.g. multi-address `ECONNREFUSED` connect failures).
 */
function walk(node: unknown, depth: number, seen: Set<object>): string | null {
  if (depth > MAX_CAUSE_DEPTH) return null;
  if (!isRecord(node)) return null;
  if (seen.has(node)) return null;
  seen.add(node);

  // Plain property read covers own AND inherited `code`. Only an
  // errno-shaped string counts; numeric/odd codes fall through to the chain.
  const code = node.code;
  if (typeof code === "string" && ERRNO_SHAPE.test(code)) return code;

  const fromCause = walk(node.cause, depth + 1, seen);
  if (fromCause !== null) return fromCause;

  // AggregateError fallback (plan D-EXTRACT: `errors[0]`).
  const errors = node.errors;
  if (Array.isArray(errors) && errors.length > 0) {
    return walk(errors[0], depth + 1, seen);
  }
  return null;
}

/**
 * Walks the full `err.cause` chain (bounded depth 6, cycle-safe, with an
 * `AggregateError.errors[0]` fallback) and returns the FIRST errno-shaped
 * `.code` string. NEVER returns message text. Returns `null` when no
 * errno-shaped string code exists anywhere in the chain.
 */
export function extractCauseCode(err: unknown): string | null {
  return walk(err, 0, new Set<object>());
}
