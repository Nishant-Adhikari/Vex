/**
 * Phase 4d — STRICT transient-vs-permanent classifier for mission auto-retry.
 *
 * Conservative by construction: only errors that are CLEARLY transient
 * provider/runtime failures (429, 5xx, request timeout, socket/network reset)
 * are `"transient"`. EVERYTHING else — 4xx incl. 401/403/404/422, validation,
 * contract, business, malformed-response, user-abort, and anything
 * unrecognized — is `"permanent"`, so the run pauses for a human instead of
 * auto-retrying.
 *
 * This is the OPPOSITE default from the inference client's `isRetryableError`
 * (which optimises for retrying its own calls and defaults to retry). The
 * mission layer must never auto-retry on uncertainty: the safety stamp is the
 * double-spend gate, and this classifier is the second, independent line —
 * both must say "yes" before a run auto-retries.
 *
 * Note the layering: the OpenRouter SDK already retries 429/5xx internally
 * (~60s). An error that still reaches here is therefore a longer outage; the
 * mission auto-retry is a second, longer-horizon layer on top.
 */

export type MissionErrorClass = "transient" | "permanent";

/** Socket / DNS / connection-reset errors — transient by nature. */
const TRANSIENT_NODE_CODES: ReadonlySet<string> = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
]);

/** VexError codes that represent a transient request-level failure. */
const TRANSIENT_VEX_CODES: ReadonlySet<string> = new Set(["HTTP_TIMEOUT"]);

/**
 * Read an arbitrary own-property off an Error (status/code/retryable live on
 * subclasses, not on the base type). The `unknown` hop is required because
 * `Error` has no index signature; it is read-only and locally contained here.
 */
function field(err: Error, key: string): unknown {
  return (err as unknown as Record<string, unknown>)[key];
}

/** Read an HTTP status from common error shapes, or null. */
function statusFrom(err: Error): number | null {
  for (const key of ["status", "statusCode"]) {
    const v = field(err, key);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  // OpenRouter/HTTP errors embed "... returned 503 ..." in the message.
  const m = /\breturned\s+(\d{3})\b/i.exec(err.message);
  return m ? Number(m[1]) : null;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

function codeOf(err: Error): string | null {
  const v = field(err, "code");
  return typeof v === "string" ? v : null;
}

/**
 * Classify a thrown error for mission auto-retry. `unknown` in (catch clauses
 * see `unknown`); defaults to `"permanent"` for any non-Error or unrecognized
 * shape.
 */
export function classifyMissionRunError(err: unknown): MissionErrorClass {
  if (!(err instanceof Error)) return "permanent";

  const code = codeOf(err);

  // A genuine request timeout is transient even if it surfaces as an AbortError
  // (millisecond-timer abort) — check the explicit timeout code FIRST so it is
  // not swallowed by the user-abort guard below.
  if (code !== null && TRANSIENT_VEX_CODES.has(code)) return "transient";

  // Any other abort (notably a user stop) is never auto-retried.
  if (err.name === "AbortError") return "permanent";

  // HTTP status is authoritative and beats a (possibly contradictory) retryable
  // marker: a 401/403/404/422 stays permanent even if some mapper set
  // retryable:true. Only 429 + 5xx are transient.
  const status = statusFrom(err);
  if (status !== null) return isTransientStatus(status) ? "transient" : "permanent";

  // No status — honor an explicit transient marker from a mapper
  // (Khalani/DexScreener set this on 429/5xx they couldn't tag with a status).
  if (field(err, "retryable") === true) return "transient";

  // Socket / connection-level transient errors.
  if (code !== null && TRANSIENT_NODE_CODES.has(code)) return "transient";

  // Unknown shape → conservative permanent (never auto-retry on uncertainty).
  return "permanent";
}
