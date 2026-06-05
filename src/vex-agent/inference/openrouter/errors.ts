/**
 * OpenRouter error normalization — REDACTED + status-preserving.
 *
 * Raw SDK errors are dangerous to surface verbatim. `OpenRouterError`
 * (the SDK base) carries `body` (raw HTTP body), `headers`, and `rawResponse`;
 * the typed subclasses additionally carry `error.metadata` (provider
 * raw/reason/details — may contain request bodies, URLs, prompt content),
 * `openrouterMetadata`, and `userId` (PII). NONE of those may reach a log line
 * or an `Error.message` that bubbles up.
 *
 * This normalizer therefore emits ONLY:
 *   - `statusCode` (authoritative HTTP status; numeric, not secret),
 *   - `error.code`  (numeric provider error code, not secret),
 *   - a BOUNDED, SCRUBBED message (provider message run through the canonical
 *     secret/PII redactor + URL scrub + length cap).
 * The whole error object is NEVER serialized.
 *
 * It also attaches the status as a LEAN OWN-PROPERTY (`statusCode` + `status`)
 * on the returned Error so `mission-error-classifier.ts` can read it directly
 * and classify transient 429/5xx for auto-retry. The status lives on a plain
 * own-property (NOT `.cause`) precisely so no serializer can walk it back into
 * the raw body/headers/PII the SDK error held.
 */

import { OpenRouterError } from "../../../lib/openrouter-client.js";
import { redact } from "../../../lib/diagnostics/text-redaction.js";

/** Max characters of a scrubbed provider message kept in the normalized error. */
const MAX_MESSAGE_LEN = 300;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** URLs (incl. paths/query) are not secrets per se but can embed tokens/PII. */
const URL_RE = /\bhttps?:\/\/[^\s'"]+/gi;
/** `Authorization: Bearer <token>` style values (redactor covers sk-* keys). */
const BEARER_RE = /\bBearer\s+[a-zA-Z0-9._-]+/gi;

/**
 * Scrub a free-text provider message down to something safe to log/surface:
 * hard-redact secrets/keys/JWT/PII via the canonical redactor, strip URLs and
 * bearer tokens, collapse whitespace, then cap the length. Returns `null` for
 * empty/whitespace input so callers can fall through to a generic message.
 */
export function scrubMessage(raw: string): string | null {
  if (raw.trim().length === 0) return null;
  let out = redact(raw).text;
  out = out.replace(BEARER_RE, "[REDACTED:bearer]");
  out = out.replace(URL_RE, "[url]");
  out = out.replace(/\s+/g, " ").trim();
  if (out.length === 0) return null;
  return out.length > MAX_MESSAGE_LEN ? `${out.slice(0, MAX_MESSAGE_LEN)}...` : out;
}

/**
 * Extract the numeric provider error code WITHOUT keeping any message/metadata.
 * Prefers the typed-subclass `error.code`; falls back to parsing only the
 * `code` field out of a JSON `body`. The body string itself is never returned.
 */
function extractErrorCode(err: Record<string, unknown>): number | null {
  if (isRecord(err.error)) {
    const code = asFiniteNumber(err.error.code);
    if (code !== null) return code;
  }
  if (typeof err.body === "string" && err.body.trim().length > 0) {
    try {
      const parsed: unknown = JSON.parse(err.body);
      if (isRecord(parsed) && isRecord(parsed.error)) {
        return asFiniteNumber(parsed.error.code);
      }
    } catch {
      // Non-JSON body — no code to extract; never surface the raw body.
    }
  }
  return null;
}

/** Pull the provider-supplied message (typed subclass `error.message`) if present. */
function extractProviderMessage(err: Record<string, unknown>): string | null {
  if (isRecord(err.error)) {
    return asNonEmptyString(err.error.message);
  }
  return null;
}

/**
 * Attach an HTTP status to an Error as LEAN, NON-ENUMERABLE own-properties
 * (`statusCode` + `status`) so the mission classifier reads it directly. Plain
 * numbers only — no `.cause` (a serializer following `.cause` could re-leak raw
 * body/headers/PII), and no reference back to any original SDK error. No-op for
 * a non-finite status. Returns the same Error for chaining.
 */
export function attachStatus(target: Error, status: number | null | undefined): Error {
  if (typeof status !== "number" || !Number.isFinite(status)) return target;
  Object.defineProperty(target, "statusCode", {
    value: status,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  Object.defineProperty(target, "status", {
    value: status,
    enumerable: false,
    writable: false,
    configurable: true,
  });
  return target;
}

/**
 * Normalize an unknown thrown value into a lean, redacted Error that preserves
 * the HTTP status as own-properties (`statusCode`/`status`) for the mission
 * auto-retry classifier. Never serializes the raw error, its body, headers,
 * metadata, `openrouterMetadata`, or `userId`.
 */
export function normalizeOpenRouterError(err: unknown, operation: string): Error {
  const fallbackMessage = err instanceof Error ? err.message : String(err);

  // Non-object throw (string/number/etc.): scrub the stringified form only.
  if (!isRecord(err)) {
    const scrubbed = scrubMessage(fallbackMessage);
    return new Error(`OpenRouter ${operation} failed: ${scrubbed ?? "unknown error"}`);
  }

  // `instanceof OpenRouterError` gives an authoritative numeric statusCode;
  // otherwise fall back to a numeric `statusCode` own-property if one exists.
  const status =
    err instanceof OpenRouterError ? err.statusCode : asFiniteNumber(err.statusCode);
  const code = extractErrorCode(err);
  const providerMessage = extractProviderMessage(err);
  const safeMessage = scrubMessage(providerMessage ?? fallbackMessage) ?? "unknown error";

  const details = [
    status !== null ? `status=${status}` : null,
    code !== null ? `code=${code}` : null,
    safeMessage,
  ].filter((part): part is string => part !== null);

  const normalized = new Error(`OpenRouter ${operation} failed: ${details.join(" | ")}`);

  // Attach the status as lean own-properties so the mission classifier reads it
  // directly (status-based, not message-regex).
  return attachStatus(normalized, status);
}
