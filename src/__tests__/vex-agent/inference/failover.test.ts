/**
 * FailoverProvider — bounded retry → provider failover → clean park.
 *
 * These tests pin the runtime-resilience contract from issue #25:
 *   - a transient blip (429/5xx/timeout/reset) is retried with backoff+jitter,
 *   - a fatal request error (4xx auth/validation) fails FAST (no retry, no
 *     failover),
 *   - when the primary exhausts its retries, the call fails over to the next
 *     configured provider,
 *   - when EVERY provider is still failing, the call throws a bounded, clearly
 *     transient terminal error (so the mission layer parks in a RECOVERABLE
 *     state instead of crashing / hot-looping),
 *   - a single-provider stack is byte-for-byte backward compatible.
 *
 * The clock is injected (`sleep`) so backoff is instant under test.
 */

import { describe, it, expect, vi } from "vitest";
import {
  FailoverProvider,
  AllProvidersFailedError,
  isTransientInferenceError,
} from "../../../vex-agent/inference/failover.js";
import { classifyMissionRunError } from "../../../vex-agent/engine/core/runner/mission-error-classifier.js";
import type {
  InferenceProvider,
  InferenceResponse,
  InferenceConfig,
} from "../../../vex-agent/inference/types.js";

// ── Test helpers ─────────────────────────────────────────────────

function httpError(status: number, message = `http ${status}`): Error {
  const e = new Error(message);
  (e as unknown as Record<string, unknown>).status = status;
  (e as unknown as Record<string, unknown>).statusCode = status;
  return e;
}

const OK_RESPONSE: InferenceResponse = {
  content: "ok",
  toolCalls: null,
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
};

const CONFIG: InferenceConfig = {
  provider: "openrouter",
  model: "test/model",
  contextLimit: 1000,
  maxOutputTokens: 100,
  inputPricePerM: 0,
  outputPricePerM: 0,
  priceCurrency: "USD",
  cachePricePerM: null,
  cacheWritePricePerM: null,
  reasoningPricePerM: null,
};

/**
 * A fake provider whose `chatCompletion` replays a queue of behaviors. Each
 * entry is either an Error to throw or an InferenceResponse to return. When the
 * queue is exhausted the LAST behavior repeats (so "always 429" is one entry).
 */
function fakeProvider(
  id: string,
  behaviors: Array<Error | InferenceResponse>,
  model?: string,
): InferenceProvider & { calls: number; lastModel: string | null } {
  let i = 0;
  const p = {
    id,
    displayName: id,
    model,
    calls: 0,
    lastModel: null as string | null,
    async loadConfig() {
      return CONFIG;
    },
    async chatCompletion(
      _m: unknown,
      _t: unknown,
      cfg: InferenceConfig,
    ): Promise<InferenceResponse> {
      p.calls++;
      p.lastModel = cfg.model;
      const behavior = behaviors[Math.min(i, behaviors.length - 1)];
      i++;
      if (behavior instanceof Error) throw behavior;
      return behavior;
    },
    async chatCompletionSimple() {
      p.calls++;
      const behavior = behaviors[Math.min(i, behaviors.length - 1)];
      i++;
      if (behavior instanceof Error) throw behavior;
      return { content: "ok", usage: OK_RESPONSE.usage };
    },
    async *chatCompletionStream() {
      /* not exercised here */
    },
    async getBalance() {
      return null;
    },
    calculateCost() {
      return {
        totalCost: 0,
        currency: "USD" as const,
        breakdown: { promptCost: 0, completionCost: 0, cachedSavings: 0, reasoningCost: 0 },
      };
    },
  } as unknown as InferenceProvider & { calls: number; lastModel: string | null };
  return p;
}

const noSleep = () => Promise.resolve();

// ── Classifier ───────────────────────────────────────────────────

describe("isTransientInferenceError", () => {
  it("treats 429 / 5xx / timeouts / connection resets as transient", () => {
    expect(isTransientInferenceError(httpError(429))).toBe(true);
    expect(isTransientInferenceError(httpError(503))).toBe(true);
    expect(isTransientInferenceError(httpError(500))).toBe(true);
    expect(isTransientInferenceError(new Error("request timed out after 5s"))).toBe(true);
    const reset = new Error("socket hang up");
    (reset as unknown as Record<string, unknown>).code = "ECONNRESET";
    expect(isTransientInferenceError(reset)).toBe(true);
  });

  it("treats undici `fetch failed` / connection-level errors as transient (retry, not fatal pause)", () => {
    // undici's bare TypeError: no status, no top-level code — matched by message.
    expect(isTransientInferenceError(new TypeError("fetch failed"))).toBe(true);
    // The wrapped phrasing seen in the wild (this is what hard-paused missions).
    expect(
      isTransientInferenceError(
        new Error(
          "OpenRouter streaming chat completion failed: Unable to make request: TypeError: fetch failed",
        ),
      ),
    ).toBe(true);
    // Real cause on `.cause` when upstream drops the top-level code.
    const wrapped = new TypeError("fetch failed");
    (wrapped as unknown as Record<string, unknown>).cause = Object.assign(
      new Error("read ECONNRESET"),
      { code: "ECONNRESET" },
    );
    expect(isTransientInferenceError(wrapped)).toBe(true);
    // undici connect-timeout + DNS not-found codes.
    const undici = new Error("connect timeout");
    (undici as unknown as Record<string, unknown>).code = "UND_ERR_CONNECT_TIMEOUT";
    expect(isTransientInferenceError(undici)).toBe(true);
    const dns = new Error("getaddrinfo ENOTFOUND openrouter.ai");
    (dns as unknown as Record<string, unknown>).code = "ENOTFOUND";
    expect(isTransientInferenceError(dns)).toBe(true);
  });

  it("does not over-broaden — a codeless/statusless non-network error stays FATAL", () => {
    expect(
      isTransientInferenceError(new Error("invalid request: unknown field 'foo'")),
    ).toBe(false);
  });

  it("treats 4xx auth/validation and aborts as FATAL (fail fast)", () => {
    expect(isTransientInferenceError(httpError(400))).toBe(false);
    expect(isTransientInferenceError(httpError(401))).toBe(false);
    expect(isTransientInferenceError(httpError(404))).toBe(false);
    expect(isTransientInferenceError(httpError(422))).toBe(false);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isTransientInferenceError(abort)).toBe(false);
  });
});

// ── Retry / failover / park ──────────────────────────────────────

describe("FailoverProvider", () => {
  it("retries a transient 429 with backoff, then succeeds", async () => {
    const sleep = vi.fn(noSleep);
    const primary = fakeProvider("primary", [httpError(429), OK_RESPONSE]);
    const fp = new FailoverProvider([primary], { maxRetriesPerProvider: 2, sleep });

    const res = await fp.chatCompletion([], [], CONFIG);

    expect(res).toEqual(OK_RESPONSE);
    expect(primary.calls).toBe(2); // failed once, retried, succeeded
    expect(sleep).toHaveBeenCalledTimes(1); // one backoff between the two attempts
  });

  it("does NOT retry a 401 — fails fast and never touches the fallback", async () => {
    const primary = fakeProvider("primary", [httpError(401)]);
    const fallback = fakeProvider("fallback", [OK_RESPONSE]);
    const fp = new FailoverProvider([primary, fallback], {
      maxRetriesPerProvider: 3,
      sleep: noSleep,
    });

    await expect(fp.chatCompletion([], [], CONFIG)).rejects.toThrow();
    expect(primary.calls).toBe(1); // fail fast, no retries
    expect(fallback.calls).toBe(0); // fatal errors do not fail over
  });

  it("fails over to the secondary when the primary exhausts transient retries", async () => {
    const primary = fakeProvider("primary", [httpError(429)]); // always 429
    const fallback = fakeProvider("fallback", [OK_RESPONSE]);
    const fp = new FailoverProvider([primary, fallback], {
      maxRetriesPerProvider: 2,
      sleep: noSleep,
    });

    const res = await fp.chatCompletion([], [], CONFIG);

    expect(res).toEqual(OK_RESPONSE);
    expect(primary.calls).toBe(3); // initial + 2 retries, all 429
    expect(fallback.calls).toBe(1); // failover succeeds first try
  });

  it("parks cleanly (bounded, recoverable) when every provider keeps failing", async () => {
    const primary = fakeProvider("primary", [httpError(429)]);
    const fallback = fakeProvider("fallback", [httpError(503)]);
    const fp = new FailoverProvider([primary, fallback], {
      maxRetriesPerProvider: 2,
      sleep: noSleep,
    });

    const err = await fp.chatCompletion([], [], CONFIG).catch((e) => e);

    expect(err).toBeInstanceOf(AllProvidersFailedError);
    // Bounded: exactly (1 + maxRetries) attempts per provider, no hot loop.
    expect(primary.calls).toBe(3);
    expect(fallback.calls).toBe(3);
    // The terminal error must classify as TRANSIENT so the mission run parks in
    // a recoverable state (auto-retry budget) instead of a permanent halt.
    expect((err as AllProvidersFailedError).retryable).toBe(true);
    expect(classifyMissionRunError(err)).toBe("transient");
  });

  it("runs each provider against ITS OWN model on failover (not the primary's)", async () => {
    // The engine builds `config` from the primary, so config.model is the
    // primary's. A fallback with a different model must be invoked with its own.
    const primary = fakeProvider("primary", [httpError(429)], "openai/gpt-4o");
    const fallback = fakeProvider(
      "fallback",
      [OK_RESPONSE],
      "qwen/qwen-2.5-72b-instruct",
    );
    const fp = new FailoverProvider([primary, fallback], {
      maxRetriesPerProvider: 0,
      sleep: noSleep,
    });

    // Caller passes the PRIMARY's config (model = openai/gpt-4o).
    await fp.chatCompletion([], [], { ...CONFIG, model: "openai/gpt-4o" });

    expect(primary.lastModel).toBe("openai/gpt-4o"); // unchanged for the primary
    expect(fallback.lastModel).toBe("qwen/qwen-2.5-72b-instruct"); // retargeted
  });

  it("prefers the primary again on the next call after a failover", async () => {
    // Primary: 429 once (forcing failover on call 1), then healthy on call 2.
    const primary = fakeProvider("primary", [httpError(429), OK_RESPONSE]);
    const fallback = fakeProvider("fallback", [OK_RESPONSE]);
    const fp = new FailoverProvider([primary, fallback], {
      maxRetriesPerProvider: 0, // no retry — one shot per provider
      sleep: noSleep,
    });

    await fp.chatCompletion([], [], CONFIG); // call 1 → primary 429 → fallback ok
    await fp.chatCompletion([], [], CONFIG); // call 2 → primary healthy again

    expect(primary.calls).toBe(2);
    expect(fallback.calls).toBe(1); // only used on call 1
  });

  it("is backward compatible with a single-provider stack", async () => {
    const only = fakeProvider("openrouter", [OK_RESPONSE]);
    const fp = new FailoverProvider([only], { sleep: noSleep });

    expect(fp.id).toBe("openrouter");
    const res = await fp.chatCompletion([], [], CONFIG);
    expect(res).toEqual(OK_RESPONSE);
    expect(only.calls).toBe(1);
  });

  it("rejects an empty provider list at construction", () => {
    expect(() => new FailoverProvider([])).toThrow();
  });
});
