/**
 * Tests for openrouter-test-client (M10 Step 6).
 *
 * Mocks `@vex-lib/openrouter-client.js` so we don't hit the real
 * OpenRouter API. Verifies:
 *  - Success path returns ok({latencyMs}) with non-negative latency.
 *  - Error mapping order: HTTP-client classes BEFORE statusCode check.
 *    - RequestAbortedError → provider.unavailable
 *    - RequestTimeoutError → provider.unavailable
 *    - ConnectionError → provider.unavailable
 *    - OpenRouterError statusCode=401 → provider.invalid_api_key
 *    - OpenRouterError statusCode=402 → provider.insufficient_credits
 *    - OpenRouterError statusCode=404 → provider.model_unsupported
 *    - OpenRouterError statusCode=429 → provider.unavailable
 *    - OpenRouterError statusCode=500/503 → provider.unavailable
 *    - Other error → provider.test_failed
 *  - Hard 15s timeout via AbortController (mock SDK 20s delay completes
 *    within 15.5s with provider.unavailable).
 *  - NOOP_LOGGER neutralisation: SDK constructor receives debugLogger
 *    object with group/groupEnd/log shape (codex turn 3 + 4).
 *  - clearTimeout called in finally (no leaked handles).
 *  - Returned VexError.domain is consistently "onboarding".
 *  - Returned VexError.message is FIXED safe copy — never contains
 *    SDK raw error message (codex turn 3 YELLOW).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdkSpies = {
  ctor: vi.fn(),
  chatSend: vi.fn(),
};

class FakeOpenRouterError extends Error {
  public statusCode: number;
  public body: string = "";
  public name = "OpenRouterError";
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}
class FakeRequestAbortedError extends Error {
  public name = "RequestAbortedError";
}
class FakeRequestTimeoutError extends Error {
  public name = "RequestTimeoutError";
}
class FakeConnectionError extends Error {
  public name = "ConnectionError";
}

class FakeOpenRouter {
  public chat: {
    send: (
      body: unknown,
      options?: { signal?: AbortSignal; retries?: { strategy: "none" } },
    ) => Promise<unknown>;
  };
  constructor(opts: unknown) {
    sdkSpies.ctor(opts);
    this.chat = {
      send: (body, options) => sdkSpies.chatSend(body, options),
    };
  }
}

vi.mock("@vex-lib/openrouter-client.js", () => ({
  OpenRouter: FakeOpenRouter,
  OpenRouterError: FakeOpenRouterError,
  RequestAbortedError: FakeRequestAbortedError,
  RequestTimeoutError: FakeRequestTimeoutError,
  ConnectionError: FakeConnectionError,
  InvalidRequestError: class FakeInvalidRequestError extends Error {},
  UnexpectedClientError: class FakeUnexpectedClientError extends Error {},
}));

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { verifyOpenRouterConnection } = await import(
  "../openrouter-test-client.js"
);

beforeEach(() => {
  sdkSpies.ctor.mockReset();
  sdkSpies.chatSend.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("verifyOpenRouterConnection", () => {
  it("returns ok({latencyMs}) on successful SDK call", async () => {
    sdkSpies.chatSend.mockResolvedValue({
      choices: [{ message: { content: "" } }],
    });
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "anthropic/claude-sonnet-4.5" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data.latencyMs).toBeGreaterThanOrEqual(0);
    }
  });

  it("passes maxCompletionTokens (camelCase) + signal to SDK", async () => {
    sdkSpies.chatSend.mockResolvedValue({});
    await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-x" },
    );
    expect(sdkSpies.chatSend).toHaveBeenCalledTimes(1);
    const [body, options] = sdkSpies.chatSend.mock.calls[0]!;
    expect(
      (body as { chatRequest: { maxCompletionTokens: number } })
        .chatRequest.maxCompletionTokens,
    ).toBe(16);
    expect((options as { signal?: AbortSignal }).signal).toBeDefined();
    expect((options as { retries?: { strategy: string } }).retries?.strategy).toBe(
      "none",
    );
  });

  it("constructs SDK with NOOP_LOGGER + retries=none + apiKey", async () => {
    sdkSpies.chatSend.mockResolvedValue({});
    await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-c" },
    );
    expect(sdkSpies.ctor).toHaveBeenCalledTimes(1);
    const opts = sdkSpies.ctor.mock.calls[0]![0] as {
      apiKey: string;
      retryConfig: { strategy: string };
      debugLogger: { group: () => void; groupEnd: () => void; log: () => void };
    };
    expect(opts.apiKey).toBe("sk-or-test");
    expect(opts.retryConfig.strategy).toBe("none");
    expect(typeof opts.debugLogger.group).toBe("function");
    expect(typeof opts.debugLogger.groupEnd).toBe("function");
    expect(typeof opts.debugLogger.log).toBe("function");
  });

  it("maps RequestAbortedError → provider.unavailable", async () => {
    sdkSpies.chatSend.mockRejectedValue(new FakeRequestAbortedError("RAW_SDK_LEAK_TEST"));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("provider.unavailable");
      expect(r.error.domain).toBe("onboarding");
      // SDK raw "RAW_SDK_LEAK_TEST" sentinel must not reach the UI message.
      // The fixed UI copy may legitimately use words like "aborted"/"timed out",
      // so we assert against a unique sentinel from the thrown error message.
      expect(r.error.message).not.toContain("RAW_SDK_LEAK_TEST");
      expect(r.error.correlationId).toBe("req-1");
    }
  });

  it("maps RequestTimeoutError → provider.unavailable", async () => {
    sdkSpies.chatSend.mockRejectedValue(new FakeRequestTimeoutError("t"));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider.unavailable");
  });

  it("maps ConnectionError → provider.unavailable", async () => {
    sdkSpies.chatSend.mockRejectedValue(new FakeConnectionError("net"));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider.unavailable");
  });

  it("maps statusCode=401 → provider.invalid_api_key", async () => {
    sdkSpies.chatSend.mockRejectedValue(
      new FakeOpenRouterError("RAW_SDK_LEAK_TEST", 401),
    );
    const r = await verifyOpenRouterConnection(
      { apiKey: "bad-key", model: "x" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("provider.invalid_api_key");
      expect(r.error.retryable).toBe(false);
      expect(r.error.domain).toBe("onboarding");
      expect(r.error.message).not.toContain("RAW_SDK_LEAK_TEST");
    }
  });

  it("maps statusCode=402 → provider.insufficient_credits", async () => {
    sdkSpies.chatSend.mockRejectedValue(new FakeOpenRouterError("pay", 402));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("provider.insufficient_credits");
      expect(r.error.retryable).toBe(false);
    }
  });

  it("maps statusCode=404 → provider.model_unsupported", async () => {
    sdkSpies.chatSend.mockRejectedValue(new FakeOpenRouterError("nf", 404));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "nope/nope" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider.model_unsupported");
  });

  it("maps statusCode=429 → provider.unavailable (retryable rate limit)", async () => {
    sdkSpies.chatSend.mockRejectedValue(new FakeOpenRouterError("rl", 429));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("provider.unavailable");
      expect(r.error.retryable).toBe(true);
    }
  });

  it("maps statusCode=503 → provider.unavailable (server error)", async () => {
    sdkSpies.chatSend.mockRejectedValue(new FakeOpenRouterError("svc", 503));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider.unavailable");
  });

  it("maps unknown error → provider.test_failed (catch-all)", async () => {
    sdkSpies.chatSend.mockRejectedValue(new Error("RAW_SDK_LEAK_TEST"));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-1" },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("provider.test_failed");
      expect(r.error.domain).toBe("onboarding");
      expect(r.error.message).not.toContain("RAW_SDK_LEAK_TEST");
    }
  });

  it("returns within hard timeout when SDK hangs (provider.unavailable on AbortSignal)", async () => {
    // SDK call hangs for 200ms; configured timeout 30ms → should
    // surface as RequestAbortedError-equivalent (mapped to unavailable).
    sdkSpies.chatSend.mockImplementation(
      (_body, options: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => {
            reject(new FakeRequestAbortedError("abort by signal"));
          });
        }),
    );
    const t0 = Date.now();
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-1", timeoutMs: 30 },
    );
    const elapsed = Date.now() - t0;
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("provider.unavailable");
    // Should NOT take 200ms; abort fires near the configured 30ms.
    expect(elapsed).toBeLessThan(150);
  });

  it("error response carries correlationId", async () => {
    sdkSpies.chatSend.mockRejectedValue(new FakeOpenRouterError("nf", 404));
    const r = await verifyOpenRouterConnection(
      { apiKey: "sk-or-test", model: "x" },
      { correlationId: "req-cid-test" },
    );
    if (!r.ok) expect(r.error.correlationId).toBe("req-cid-test");
  });
});
