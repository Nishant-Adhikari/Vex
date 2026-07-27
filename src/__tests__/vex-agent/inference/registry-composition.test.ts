/**
 * Composition of the two independent fallback features on the OpenRouter stack:
 *
 *   #25 — provider-level failover: a SEPARATE `OPENROUTER_API_KEY_FALLBACK`
 *          (+ `AGENT_MODEL_FALLBACK`) pushes a SECONDARY provider with its own
 *          key onto the {@link FailoverProvider} stack.
 *   #37/#40 — intra-provider model fallback: when the PRIMARY model is absent
 *          from the `/models` catalog, the PRIMARY provider self-heals onto
 *          `AGENT_MODEL_FALLBACK` (its OWN key) instead of returning null.
 *
 * These overlap on `AGENT_MODEL_FALLBACK`. If BOTH are configured, a
 * self-healing primary returns a non-null config built for the fallback MODEL
 * on the PRIMARY key — which stops `FailoverProvider.loadConfig`'s first-non-
 * null walk at the primary, so the #25 secondary (with its OWN key — the whole
 * reason a separate key exists, e.g. BYOK / separate billing) is NEVER
 * consulted. The primary key may not be able to access the fallback model at
 * all → a #25-recoverable model_not_found is silently turned into a config that
 * will 404 (fatal) on the wrong key.
 *
 * The fix makes the two mutually exclusive by construction: when a #25 secondary
 * is configured the registry builds the PRIMARY with intra-provider model
 * fallback DISABLED, so the primary returns null on model_not_found and the walk
 * reaches the secondary. A single-key setup (no #25 secondary) keeps the
 * intra-provider fallback exactly as before.
 *
 * The OpenRouter SDK is mocked so `/models` is a controllable, key-aware
 * `models.list`; the registry/openrouter/failover modules are the REAL ones so
 * this exercises the composed stack end to end.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const PRIMARY_KEY = "sk-or-primary";
const FALLBACK_KEY = "sk-or-fallback";
const PRIMARY_MODEL = "google/gemini-2.0-flash-001"; // retired/absent from catalog
const FALLBACK_MODEL = "openai/gpt-4o-mini"; // present in catalog

const PRICING = { prompt: "0.000001", completion: "0.000002" };

/** Build a `/models` catalog listing exactly the given model ids. */
function catalog(...ids: string[]) {
  return { data: ids.map((id) => ({ id, pricing: PRICING })) };
}

// Records which API key each provider's `models.list` was invoked with, so a
// test can prove whether the SECONDARY provider (fallback key) was ever reached.
const listCalls: string[] = [];
// `listMock(apiKey)` returns the catalog that key's `/models` sees. The catalog
// is global (key-independent) in reality, so both keys see the same list.
const listMock = vi.fn();

vi.mock("@openrouter/sdk", () => ({
  OpenRouter: class {
    private readonly apiKey: string;
    readonly models: { list: (args: unknown) => Promise<unknown> };
    readonly chat = { send: vi.fn() };
    readonly credits = {};
    readonly apiKeys = {};
    constructor(opts: { apiKey: string }) {
      this.apiKey = opts.apiKey;
      this.models = {
        list: async (_args: unknown) => {
          listCalls.push(this.apiKey);
          return listMock(this.apiKey);
        },
      };
    }
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

const { resolveProvider, resetProvider } = await import(
  "../../../vex-agent/inference/registry.js"
);

/** True iff the primary self-healed onto its intra-provider fallback model. */
function primarySelfHealed(): boolean {
  return loggerMock.warn.mock.calls.some(
    (c) => c[0] === "inference.model.fallback_used",
  );
}

describe("registry composition — #25 provider fallback ⇄ #37/#40 model fallback", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    resetProvider();
    listCalls.length = 0;
    listMock.mockReset();
    loggerMock.error.mockClear();
    loggerMock.warn.mockClear();
    loggerMock.info.mockClear();
    for (const key of Object.keys(process.env)) {
      if (key.startsWith("AGENT_") || key.startsWith("OPENROUTER_")) {
        delete process.env[key];
      }
    }
  });

  afterEach(() => {
    resetProvider();
    process.env = { ...originalEnv };
  });

  it("with a SEPARATE #25 fallback provider, loadConfig fails over to the SECONDARY instead of self-healing the primary onto the fallback model", async () => {
    // Both features configured — they overlap on AGENT_MODEL_FALLBACK.
    process.env.OPENROUTER_API_KEY = PRIMARY_KEY;
    process.env.AGENT_MODEL = PRIMARY_MODEL;
    process.env.OPENROUTER_API_KEY_FALLBACK = FALLBACK_KEY;
    process.env.AGENT_MODEL_FALLBACK = FALLBACK_MODEL;

    // Global catalog: the primary model is retired (absent); the fallback is present.
    listMock.mockResolvedValue(catalog(FALLBACK_MODEL));

    const provider = await resolveProvider();
    expect(provider).not.toBeNull();

    const config = await provider!.loadConfig();

    // A config is resolved (no hard "no inference config" halt) …
    expect(config).not.toBeNull();
    expect(config?.model).toBe(FALLBACK_MODEL);

    // … and it came from the SECONDARY provider: its own (fallback) key's
    // `/models` was consulted, i.e. the walk did NOT stop at a self-healed
    // primary. Before the fix the primary self-heals and the fallback key is
    // never touched.
    expect(listCalls).toContain(FALLBACK_KEY);
    // The primary must NOT have self-healed onto the fallback model on its OWN
    // key (that is exactly the silent-defeat-of-#25 bug).
    expect(primarySelfHealed()).toBe(false);
  });

  it("single-key setup (no #25 secondary) still self-heals via intra-provider model fallback", async () => {
    // Only the intra-provider fallback is configured (no separate fallback key).
    process.env.OPENROUTER_API_KEY = PRIMARY_KEY;
    process.env.AGENT_MODEL = PRIMARY_MODEL;
    process.env.AGENT_MODEL_FALLBACK = FALLBACK_MODEL;

    listMock.mockResolvedValue(catalog(FALLBACK_MODEL)); // primary absent

    const provider = await resolveProvider();
    const config = await provider!.loadConfig();

    // Intra-provider fallback still engages — existing behavior preserved.
    expect(config?.model).toBe(FALLBACK_MODEL);
    expect(primarySelfHealed()).toBe(true);
    // Single key only — the fallback key never exists.
    expect(listCalls).not.toContain(FALLBACK_KEY);
  });
});
