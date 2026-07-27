/**
 * AGENT_MODEL_FALLBACK — model-availability failover in OpenRouterProvider.
 *
 * Motivation (a real incident): a retired/mistyped `AGENT_MODEL` slug
 * (`google/gemini-2.0-flash-001`) is absent from OpenRouter's `/models`
 * catalog, so the fork's pre-flight validation in `_fetchConfig` classifies it
 * `model_not_found`, `loadConfig()` returns null, and the engine hard-throws
 * "No inference config available" with no recovery.
 *
 * The guardrail: when `AGENT_MODEL_FALLBACK` is set AND the primary model is a
 * model-availability miss (absent from the catalog) AND the fallback differs
 * from the primary, resolve the request ONCE against the fallback model instead
 * of erroring — logging `inference.model.fallback_used {primary, fallback}`.
 * Unset ⇒ behavior is byte-identical to before (no fallback, model_not_found
 * stays a null config). A NON-availability error (a transient `/models`
 * failure) never triggers the fallback — it must not mask real outages.
 *
 * The OpenRouter SDK is mocked so `models.list` is a controllable vi.fn; the
 * logger is mocked so the fallback warn can be asserted.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const listMock = vi.fn();

vi.mock("@openrouter/sdk", () => ({
  OpenRouter: class {
    readonly models = { list: listMock };
    readonly chat = {};
    readonly credits = {};
    readonly apiKeys = {};
    constructor(_opts: unknown) {}
  },
}));

const loggerMock = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: vi.fn(),
}));
vi.mock("@utils/logger.js", () => ({
  default: loggerMock,
  logger: loggerMock,
  createChildLogger: () => loggerMock,
}));

const { OpenRouterProvider } = await import("../../../vex-agent/inference/openrouter.js");

const PRIMARY_ID = "google/gemini-2.0-flash-001"; // the mistyped/retired slug
const FALLBACK_ID = "openai/gpt-4o-mini"; // a known-good fallback

const PRICING = {
  prompt: "0.000001",
  completion: "0.000002",
};

/** Build a `/models` catalog listing exactly the given model ids. */
function catalog(...ids: string[]) {
  return { data: ids.map((id) => ({ id, pricing: PRICING })) };
}

/** Find the metadata object of the single `inference.model.fallback_used` warn. */
function fallbackWarnMeta(): Record<string, unknown> | undefined {
  const call = loggerMock.warn.mock.calls.find(
    (c) => c[0] === "inference.model.fallback_used",
  );
  return call?.[1] as Record<string, unknown> | undefined;
}

/** Metadata of the single `inference.model.fallback_reverted` (flap-back) warn. */
function fallbackRevertMeta(): Record<string, unknown> | undefined {
  const call = loggerMock.warn.mock.calls.find(
    (c) => c[0] === "inference.model.fallback_reverted",
  );
  return call?.[1] as Record<string, unknown> | undefined;
}

describe("OpenRouterProvider AGENT_MODEL_FALLBACK model-availability failover", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    listMock.mockReset();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("AGENT_") || key.startsWith("OPENROUTER_")) {
        delete process.env[key];
      }
    }
    process.env.OPENROUTER_API_KEY = "sk-or-test";
    process.env.AGENT_MODEL = PRIMARY_ID;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("retries with the fallback model when the primary is model_not_found and a fallback is set", async () => {
    process.env.AGENT_MODEL_FALLBACK = FALLBACK_ID;
    // Catalog lists ONLY the fallback — the primary slug is retired/absent.
    listMock.mockResolvedValue(catalog(FALLBACK_ID));
    const provider = new OpenRouterProvider();

    const config = await provider.loadConfig();

    // The request succeeded against the FALLBACK model id.
    expect(config).not.toBeNull();
    expect(config?.model).toBe(FALLBACK_ID);
    // Provider identity reflects the active (fallback) model so the failover
    // wrapper's per-turn config.model retarget stays consistent.
    expect(provider.model).toBe(FALLBACK_ID);
    // A single, clearly-labelled warn naming both models.
    const meta = fallbackWarnMeta();
    expect(meta).toBeDefined();
    expect(meta?.primary).toBe(PRIMARY_ID);
    expect(meta?.fallback).toBe(FALLBACK_ID);
  });

  it("propagates the original model_not_found (null config) with NO retry when the fallback is unset", async () => {
    // AGENT_MODEL_FALLBACK intentionally absent.
    listMock.mockResolvedValue(catalog(FALLBACK_ID)); // primary absent
    const provider = new OpenRouterProvider();

    const config = await provider.loadConfig();

    expect(config).toBeNull();
    expect(provider.model).toBe(PRIMARY_ID); // never switched
    expect(fallbackWarnMeta()).toBeUndefined();
    // model_not_found stays loud (unchanged behavior).
    expect(
      loggerMock.error.mock.calls.some(
        (c) => c[0] === "inference.openrouter.model_not_found",
      ),
    ).toBe(true);
  });

  it("surfaces the original error and attempts the fallback at most once when the fallback ALSO fails", async () => {
    process.env.AGENT_MODEL_FALLBACK = FALLBACK_ID;
    // Catalog lists NEITHER the primary NOR the fallback.
    listMock.mockResolvedValue(catalog("some/other-model"));
    const provider = new OpenRouterProvider();

    const config = await provider.loadConfig();

    // Original behavior surfaced (null config → engine's model_not_found path).
    expect(config).toBeNull();
    // No fallback claimed — the fallback was also unavailable.
    expect(fallbackWarnMeta()).toBeUndefined();
    // Bounded: exactly one catalog fetch, no retry loop.
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(provider.model).toBe(PRIMARY_ID); // did not stick to a bad fallback
  });

  it("does NOT trigger the fallback on a non-availability (transient) error", async () => {
    process.env.AGENT_MODEL_FALLBACK = FALLBACK_ID;
    // A transient `/models` outage — NOT a model-availability miss.
    listMock.mockRejectedValue(new Error("transient /models 503"));
    const provider = new OpenRouterProvider();

    const config = await provider.loadConfig();

    expect(config).toBeNull();
    expect(fallbackWarnMeta()).toBeUndefined();
    expect(provider.model).toBe(PRIMARY_ID); // stayed on primary, no masking
  });

  it("treats a fallback equal to the primary as no fallback (must differ)", async () => {
    process.env.AGENT_MODEL_FALLBACK = PRIMARY_ID; // same as AGENT_MODEL
    listMock.mockResolvedValue(catalog(FALLBACK_ID)); // primary absent
    const provider = new OpenRouterProvider();

    const config = await provider.loadConfig();

    expect(config).toBeNull();
    expect(fallbackWarnMeta()).toBeUndefined();
  });

  it("logs fallback_reverted and restores the primary when it returns on the next TTL refresh (state C)", async () => {
    vi.useFakeTimers();
    try {
      process.env.AGENT_MODEL_FALLBACK = FALLBACK_ID;
      const provider = new OpenRouterProvider();

      // Fetch 1: primary absent → fallback engaged.
      listMock.mockResolvedValueOnce(catalog(FALLBACK_ID));
      const c1 = await provider.loadConfig();
      expect(c1?.model).toBe(FALLBACK_ID);
      expect(provider.model).toBe(FALLBACK_ID);
      expect(fallbackWarnMeta()?.fallback).toBe(FALLBACK_ID);
      expect(fallbackRevertMeta()).toBeUndefined(); // not yet reverted

      // Advance past the config cache TTL so the next loadConfig re-fetches.
      vi.advanceTimersByTime(3_600_001);

      // Fetch 2: the primary is back → revert, with a symmetric warn.
      listMock.mockResolvedValueOnce(catalog(PRIMARY_ID, FALLBACK_ID));
      const c2 = await provider.loadConfig();

      expect(c2?.model).toBe(PRIMARY_ID); // returned config reverted
      expect(provider.model).toBe(PRIMARY_ID); // getter reverted too
      const revert = fallbackRevertMeta();
      expect(revert).toBeDefined();
      expect(revert?.primary).toBe(PRIMARY_ID);
      expect(revert?.previous).toBe(FALLBACK_ID);
      expect(listMock).toHaveBeenCalledTimes(2); // one fetch per TTL window
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not touch the fallback when the primary model is available", async () => {
    process.env.AGENT_MODEL_FALLBACK = FALLBACK_ID;
    listMock.mockResolvedValue(catalog(PRIMARY_ID, FALLBACK_ID));
    const provider = new OpenRouterProvider();

    const config = await provider.loadConfig();

    expect(config?.model).toBe(PRIMARY_ID);
    expect(provider.model).toBe(PRIMARY_ID);
    expect(fallbackWarnMeta()).toBeUndefined();
  });
});
