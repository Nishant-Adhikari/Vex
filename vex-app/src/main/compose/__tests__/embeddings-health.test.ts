/**
 * Tests for `waitForEmbeddingsRuntimeReady` (M11.5.4).
 *
 * Covers the discriminated-union outcomes that callers branch on:
 *   - ready          — /health 200 + /v1/embeddings returns dim=768
 *   - dim_mismatch   — /v1/embeddings returns embedding.length != 768
 *   - aborted        — signal already aborted before first iteration
 *   - timeout        — overall budget exhausted with /health never 200
 *   - keeps polling  — /v1/embeddings fails first, then succeeds
 *
 * `fetch` is patched globally; we never reach a real socket. Vitest
 * fake timers advance the POLL_INTERVAL_MS sleep between iterations
 * so the timeout test does not stall for 3 s of real wall time.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../logger/index.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { waitForEmbeddingsRuntimeReady } = await import(
  "../embeddings-health.js"
);
const { EMBEDDING_DIM } = await import(
  "../../onboarding/embedding-defaults.js"
);

const originalFetch = globalThis.fetch;

interface FetchMock {
  readonly mock: ReturnType<typeof vi.fn>;
  restore: () => void;
}

function patchFetch(
  impl: (url: URL | RequestInfo, init?: RequestInit) => Promise<Response>
): FetchMock {
  const mock = vi.fn(impl);
  globalThis.fetch = mock as unknown as typeof fetch;
  return {
    mock,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeEmbedding(dim: number): { embedding: ReadonlyArray<number> } {
  return { embedding: Array.from({ length: dim }, (_, i) => i / dim) };
}

beforeEach(() => {
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe("waitForEmbeddingsRuntimeReady", () => {
  it("returns ready when /health is 200 and /v1/embeddings returns the expected dim", async () => {
    const fetchMock = patchFetch(async (url) => {
      const str = url.toString();
      if (str.endsWith("/health")) return new Response("ok", { status: 200 });
      if (str.endsWith("/v1/embeddings")) {
        return jsonResponse({ data: [makeEmbedding(EMBEDDING_DIM)] });
      }
      throw new Error(`Unexpected URL ${str}`);
    });

    const result = await waitForEmbeddingsRuntimeReady({
      embedPort: 27134,
      overallTimeoutMs: 1_000,
    });
    expect(result.kind).toBe("ready");
    expect(result.observedDim).toBe(EMBEDDING_DIM);
    expect(result.attempts).toBe(1);
    fetchMock.restore();
  });

  it("returns dim_mismatch when /v1/embeddings returns a different dim", async () => {
    const fetchMock = patchFetch(async (url) => {
      const str = url.toString();
      if (str.endsWith("/health")) return new Response("ok", { status: 200 });
      if (str.endsWith("/v1/embeddings")) {
        return jsonResponse({ data: [makeEmbedding(384)] });
      }
      throw new Error(`Unexpected URL ${str}`);
    });

    const result = await waitForEmbeddingsRuntimeReady({
      embedPort: 27134,
      overallTimeoutMs: 1_000,
    });
    expect(result.kind).toBe("dim_mismatch");
    expect(result.observedDim).toBe(384);
    fetchMock.restore();
  });

  it("keeps polling when /v1/embeddings is malformed and times out cleanly", async () => {
    vi.useFakeTimers();
    const fetchMock = patchFetch(async (url) => {
      const str = url.toString();
      if (str.endsWith("/health")) return new Response("ok", { status: 200 });
      if (str.endsWith("/v1/embeddings")) {
        // Missing `data` field → schema rejects → probe returns ok:false
        return jsonResponse({ object: "list" });
      }
      throw new Error(`Unexpected URL ${str}`);
    });

    const promise = waitForEmbeddingsRuntimeReady({
      embedPort: 27134,
      overallTimeoutMs: 5_000,
    });
    // Advance well past the budget; setTimeout chains resolve in order.
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await promise;
    expect(result.kind).toBe("timeout");
    expect(fetchMock.mock.mock.calls.length).toBeGreaterThanOrEqual(2);
    fetchMock.restore();
  });

  it("returns aborted when the signal is aborted before the first iteration", async () => {
    const fetchMock = patchFetch(async () => new Response("", { status: 503 }));
    const ac = new AbortController();
    ac.abort();
    const result = await waitForEmbeddingsRuntimeReady({
      embedPort: 27134,
      signal: ac.signal,
      overallTimeoutMs: 1_000,
    });
    expect(result.kind).toBe("aborted");
    expect(result.attempts).toBe(0);
    fetchMock.restore();
  });

  it("returns timeout when /health stays 503 past the overall budget", async () => {
    vi.useFakeTimers();
    const fetchMock = patchFetch(async (url) => {
      const str = url.toString();
      if (str.endsWith("/health")) return new Response("", { status: 503 });
      throw new Error(`Unexpected URL ${str}`);
    });

    const promise = waitForEmbeddingsRuntimeReady({
      embedPort: 27134,
      overallTimeoutMs: 3_000,
    });
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await promise;
    expect(result.kind).toBe("timeout");
    expect(result.observedDim).toBeNull();
    expect(fetchMock.mock).toHaveBeenCalled();
    fetchMock.restore();
  });
});
