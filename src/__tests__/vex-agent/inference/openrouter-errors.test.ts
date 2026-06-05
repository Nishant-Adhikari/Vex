/**
 * normalizeOpenRouterError + attachStatus — REDACTION & STATUS invariants.
 *
 * B-000 characterization: pins the post-hardening observable contract of the
 * OpenRouter error normalizer. The load-bearing invariants are:
 *   (1) the normalized `Error.message` carries ONLY `status=` / `code=` / a
 *       bounded SCRUBBED provider message — never metadata, raw body, headers,
 *       `openrouterMetadata`, or `userId` (PII);
 *   (2) the HTTP status is attached as a lean own-property (`statusCode` +
 *       `status`) so the mission classifier can auto-retry transient 429/5xx;
 *   (3) secrets/keys/URLs embedded in a provider message are scrubbed.
 */

import { describe, it, expect } from "vitest";
import {
  normalizeOpenRouterError,
  attachStatus,
} from "../../../vex-agent/inference/openrouter/errors.js";
import { OpenRouterError } from "../../../lib/openrouter-client.js";

/** Read a (non-enumerable) own-property the way the classifier does. */
function field(err: Error, key: string): unknown {
  return (err as unknown as Record<string, unknown>)[key];
}

/**
 * Build a typed-subclass-shaped SDK error: own `error{code,message,metadata}`
 * plus the leaky `body` / `openrouterMetadata` / `userId` fields the real
 * subclasses carry. We do NOT need a real subclass instance to prove redaction
 * of the data fields; a separate test exercises the `instanceof` branch.
 */
function typedError(opts: {
  statusCode: number;
  code: number;
  message: string;
  metadata?: Record<string, unknown>;
  body?: string;
  openrouterMetadata?: Record<string, unknown>;
  userId?: string;
}): Error {
  const e = new Error("sdk top-level message that may itself leak");
  Object.assign(e, {
    statusCode: opts.statusCode,
    error: { code: opts.code, message: opts.message, metadata: opts.metadata },
    body: opts.body,
    openrouterMetadata: opts.openrouterMetadata,
    userId: opts.userId,
  });
  return e;
}

describe("normalizeOpenRouterError — redaction invariants", () => {
  it("emits ONLY status + code + scrubbed message; never metadata/body/PII", () => {
    const err = typedError({
      statusCode: 429,
      code: 429,
      message: "Rate limit exceeded for org",
      metadata: { raw: "PROVIDER_RAW_SECRET", reason: "LEAKY_REASON", provider_name: "acme" },
      body: '{"error":{"code":429,"message":"BODY_SHOULD_NOT_APPEAR"}}',
      openrouterMetadata: { internal: "OR_META_LEAK" },
      userId: "user_pii_12345",
    });

    const normalized = normalizeOpenRouterError(err, "chat completion");
    const msg = normalized.message;

    // Kept facts.
    expect(msg).toContain("status=429");
    expect(msg).toContain("code=429");
    expect(msg).toContain("Rate limit exceeded for org");

    // NEVER leaked.
    expect(msg).not.toContain("PROVIDER_RAW_SECRET");
    expect(msg).not.toContain("LEAKY_REASON");
    expect(msg).not.toContain("acme");
    expect(msg).not.toContain("BODY_SHOULD_NOT_APPEAR");
    expect(msg).not.toContain("OR_META_LEAK");
    expect(msg).not.toContain("user_pii_12345");
    expect(msg).not.toContain("metadata");
  });

  it("scrubs api keys / bearer tokens / URLs out of the provider message", () => {
    const err = typedError({
      statusCode: 401,
      code: 401,
      message:
        "auth failed with key sk-or-abcdefghijklmnopqrstuvwxyz0123 and Bearer eyJsecrettoken123 calling https://api.openrouter.ai/v1/secret?key=leak",
    });
    const msg = normalizeOpenRouterError(err, "chat completion").message;

    expect(msg).not.toContain("sk-or-abcdefghijklmnopqrstuvwxyz0123");
    expect(msg).not.toContain("eyJsecrettoken123");
    expect(msg).not.toContain("https://api.openrouter.ai");
    expect(msg).not.toContain("key=leak");
    // Shape preserved enough to be useful.
    expect(msg).toContain("status=401");
    expect(msg).toContain("code=401");
  });

  it("bounds the scrubbed message length", () => {
    const long = "x".repeat(5000);
    const err = typedError({ statusCode: 500, code: 500, message: long });
    const msg = normalizeOpenRouterError(err, "chat completion").message;
    // Prefix + bounded body + ellipsis — far under the original 5000 chars.
    expect(msg.length).toBeLessThan(400);
    expect(msg).toContain("...");
  });

  it("never serializes the whole error object even when there is no `error` field", () => {
    // A bare OpenRouterError-shaped object (only statusCode + body, no typed
    // `error`). The body must NOT be echoed.
    const err = new Error("top-level");
    Object.assign(err, {
      statusCode: 502,
      body: '{"error":{"code":502,"message":"upstream exploded RAW_BODY_LEAK"}}',
    });
    const msg = normalizeOpenRouterError(err, "streaming chat completion").message;
    expect(msg).toContain("status=502");
    expect(msg).toContain("code=502"); // code extracted from JSON body
    expect(msg).not.toContain("RAW_BODY_LEAK"); // body text never echoed
  });

  it("handles a non-object throw without leaking", () => {
    const msg = normalizeOpenRouterError("plain string boom", "chat completion").message;
    expect(msg).toBe("OpenRouter chat completion failed: plain string boom");
  });
});

describe("normalizeOpenRouterError — status own-property (classifier contract)", () => {
  it("attaches statusCode AND status as own-properties for 429", () => {
    const err = typedError({ statusCode: 429, code: 429, message: "rate limited" });
    const normalized = normalizeOpenRouterError(err, "chat completion");
    expect(field(normalized, "statusCode")).toBe(429);
    expect(field(normalized, "status")).toBe(429);
  });

  it("attaches the status for 5xx too", () => {
    const err = typedError({ statusCode: 503, code: 503, message: "unavailable" });
    const normalized = normalizeOpenRouterError(err, "chat completion");
    expect(field(normalized, "statusCode")).toBe(503);
    expect(field(normalized, "status")).toBe(503);
  });

  it("uses instanceof OpenRouterError for authoritative status extraction", () => {
    const real = new OpenRouterError("rate limited", {
      response: new Response('{"error":{"code":429,"message":"slow down"}}', { status: 429 }),
      request: new Request("https://openrouter.ai/api/v1/chat/completions"),
      body: '{"error":{"code":429,"message":"slow down"}}',
    });
    const normalized = normalizeOpenRouterError(real, "chat completion");
    expect(field(normalized, "statusCode")).toBe(429);
    expect(normalized.message).toContain("status=429");
    // The raw request URL must not leak via the message.
    expect(normalized.message).not.toContain("openrouter.ai");
  });

  it("does not attach a status when none is present", () => {
    const err = new Error("no status here");
    const normalized = normalizeOpenRouterError(err, "chat completion");
    expect(field(normalized, "statusCode")).toBeUndefined();
    expect(field(normalized, "status")).toBeUndefined();
  });

  it("ignores a non-finite statusCode", () => {
    const err = new Error("weird");
    Object.assign(err, { statusCode: NaN });
    const normalized = normalizeOpenRouterError(err, "chat completion");
    expect(field(normalized, "statusCode")).toBeUndefined();
  });
});

describe("attachStatus", () => {
  it("attaches non-enumerable statusCode + status and returns the same error", () => {
    const e = new Error("x");
    const out = attachStatus(e, 502);
    expect(out).toBe(e);
    expect(field(e, "statusCode")).toBe(502);
    expect(field(e, "status")).toBe(502);
    // Non-enumerable → not walked by JSON.stringify / Object.keys.
    expect(Object.keys(e)).not.toContain("statusCode");
  });

  it("is a no-op for null / undefined / non-finite", () => {
    for (const bad of [null, undefined, NaN, Infinity]) {
      const e = new Error("x");
      attachStatus(e, bad as number | null | undefined);
      expect(field(e, "statusCode")).toBeUndefined();
    }
  });
});
