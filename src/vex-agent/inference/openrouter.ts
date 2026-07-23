/**
 * OpenRouter inference provider — SDK-based with streaming + tool calling.
 *
 * Uses @openrouter/sdk for all communication. SDK handles:
 * - Retry with backoff (429, 5xx)
 * - Timeout management
 * - Auth header injection
 * - Zod-validated response parsing
 *
 * Streaming: SDK returns EventStream<ChatStreamChunk> which
 * we consume and yield as provider-agnostic StreamChunk instances.
 *
 * Tool calling: both streaming (delta accumulation) and non-streaming paths.
 *
 * Message mapping, response parsing, and streaming accumulation in openrouter-mappers.ts.
 *
 * @see https://openrouter.ai/docs/quickstart
 */

import { OpenRouter } from "@openrouter/sdk";
import type { ChatRequest } from "@openrouter/sdk/models/chatrequest.js";
import type { ChatResult } from "@openrouter/sdk/models/chatresult.js";
import type { ChatStreamChunk } from "@openrouter/sdk/models/chatstreamchunk.js";
import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";

import type {
  InferenceProvider,
  InferenceConfig,
  InferenceResponse,
  InferenceUsage,
  StreamChunk,
  ProviderBalance,
  ProviderMessage,
  ToolDefinition,
  RequestCost,
} from "./types.js";

import { loadEnvConfig } from "./config.js";
import {
  OPENROUTER_APP_URL,
  OPENROUTER_APP_TITLE,
  OPENROUTER_SDK_TIMEOUT_MS,
  OPENROUTER_LOW_BALANCE_USD,
  MODEL_CONFIG_CACHE_TTL_MS,
  MODEL_CONFIG_STALE_RETRY_MS,
} from "./config.js";

import logger from "@utils/logger.js";
import { extractCauseCode } from "../../lib/error-cause.js";
import { normalizeOpenRouterError } from "./openrouter/errors.js";
import { extractUsage, parseNonStreamingResponse } from "./openrouter/mappers.js";
import { buildOpenRouterParams } from "./openrouter/params.js";
import { computeRequestCost } from "./openrouter/cost.js";
import { consumeOpenRouterStream } from "./openrouter/stream.js";

// ── Pricing parse ────────────────────────────────────────────────
//
// OpenRouter `/models` pricing fields are per-TOKEN decimal strings. Convert
// to per-1M and reject any non-finite result (missing field, non-numeric, NaN,
// Infinity) so a malformed catalog entry can never propagate NaN into cost
// math — it becomes `null`, and required prices fall back to 0 at the call site.
function parsePricePerM(raw: unknown): number | null {
  if (raw === undefined || raw === null || raw === "") return null;
  const perToken = parseFloat(String(raw));
  if (!Number.isFinite(perToken)) return null;
  const perM = perToken * 1_000_000;
  return Number.isFinite(perM) ? perM : null;
}

// ── api_unreachable hint selection (error-diagnostics D-RUNTIME) ─
//
// The generic "Check OPENROUTER_API_KEY" hint is actively misleading when the
// real failure is TLS interception (antivirus/proxy) or DNS. Pick the hint
// from the errno-shaped cause code; the code itself is logged alongside.
const TLS_CAUSE_CODES: ReadonlySet<string> = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "CERT_HAS_EXPIRED",
]);
const DNS_CAUSE_CODES: ReadonlySet<string> = new Set(["ENOTFOUND", "EAI_AGAIN"]);

function apiUnreachableHint(causeCode: string | null): string {
  if (causeCode !== null && TLS_CAUSE_CODES.has(causeCode)) {
    return (
      "TLS certificate verification failed — antivirus or proxy HTTPS " +
      "inspection may be intercepting connections"
    );
  }
  if (causeCode !== null && DNS_CAUSE_CODES.has(causeCode)) {
    return "DNS lookup failed — check your network connection or DNS settings";
  }
  return "Check OPENROUTER_API_KEY and network connectivity";
}

// ── Provider ─────────────────────────────────────────────────────

/**
 * Per-instance overrides. Every field defaults to the resolved ENV config, so
 * `new OpenRouterProvider()` is unchanged. The failover stack (issue #25)
 * constructs a SECOND instance with an explicit `{ apiKey, model }` — the
 * fallback provider — without mutating global ENV.
 */
export interface OpenRouterProviderInit {
  apiKey?: string;
  model?: string;
  /**
   * Optional model-availability fallback. When the PRIMARY `model` is absent
   * from the `/models` catalog (a retired/mistyped slug — OpenRouter
   * `model_not_found`) and this differs from the primary, `loadConfig()`
   * resolves the request against this model instead of erroring (issue #37).
   * Defaults to `AGENT_MODEL_FALLBACK` (read the same way `model` reads
   * `AGENT_MODEL`); unset ⇒ no fallback, behavior unchanged.
   */
  fallbackModel?: string;
  displayName?: string;
}

export class OpenRouterProvider implements InferenceProvider {
  readonly id = "openrouter";
  readonly displayName: string;

  private readonly apiKey: string;
  /** The ENV-configured primary model — the preferred target on every fetch. */
  private readonly primaryModel: string;
  /**
   * Optional model-availability fallback (differs from primary, or null). Used
   * only when the primary is absent from the `/models` catalog (issue #37).
   */
  private readonly fallbackModel: string | null;
  /**
   * The model the LAST successful config load resolved to — the primary
   * normally, or {@link fallbackModel} after a model-availability failover.
   * Exposed via {@link model} so the failover wrapper's per-turn `config.model`
   * retarget (`FailoverProvider.configFor`) stays consistent with the model the
   * returned config was actually built for.
   */
  private activeModel: string;
  /** Public so the failover wrapper can retarget `config.model` on a failover. */
  get model(): string {
    return this.activeModel;
  }
  private readonly contextLimit: number;
  private readonly temperature: number | undefined;
  private readonly maxOutputTokens: number;
  private readonly client: OpenRouter;

  // ── loadConfig cache (F4) ───────────────────────────────────────
  // `loadConfig()` is called once per turn but `/models` pricing is stable.
  // We memoize the last SUCCESSFUL config and reuse it for the TTL, dedup
  // concurrent fetches, and serve the last-good config on a transient
  // metadata failure (throttled). `cachedConfig` is the single canonical
  // reference — every return path hands out a fresh shallow copy so callers
  // can never mutate the cache.
  private cachedConfig: InferenceConfig | null = null;
  private cachedAt = 0;
  private staleServeUntil = 0;
  private inFlight: Promise<InferenceConfig | null> | null = null;

  constructor(init: OpenRouterProviderInit = {}) {
    const env = loadEnvConfig();

    const apiKey = init.apiKey ?? env.openrouterApiKey;
    const model = init.model ?? env.agentModel;
    // Read AGENT_MODEL_FALLBACK exactly the way `model` reads AGENT_MODEL
    // (init override → resolved ENV). A fallback equal to the primary is a
    // no-op (nothing to fail over to), so it is normalized to null.
    const fallbackModel = init.fallbackModel ?? env.fallbackAgentModel;

    if (!apiKey) {
      throw new Error("OPENROUTER_API_KEY is required for OpenRouter provider");
    }
    if (!model) {
      throw new Error("AGENT_MODEL is required for OpenRouter provider");
    }

    this.displayName = init.displayName ?? "OpenRouter";
    this.apiKey = apiKey;
    this.primaryModel = model;
    this.activeModel = model;
    this.fallbackModel =
      fallbackModel && fallbackModel !== model ? fallbackModel : null;
    this.contextLimit = env.contextLimit;
    this.temperature = env.temperature ?? undefined;
    this.maxOutputTokens = env.maxOutputTokens;

    this.client = new OpenRouter({
      apiKey: this.apiKey,
      httpReferer: OPENROUTER_APP_URL,
      appTitle: OPENROUTER_APP_TITLE,
      timeoutMs: OPENROUTER_SDK_TIMEOUT_MS,
      retryConfig: {
        strategy: "backoff",
        backoff: {
          initialInterval: 2000,
          maxInterval: 15000,
          exponent: 2,
          maxElapsedTime: 60000,
        },
      },
    });
  }

  // ── loadConfig (cached) ─────────────────────────────────────────
  //
  // F4: the raw `/models` fetch lives in `_fetchConfig()`; this wrapper
  // memoizes the result so the per-turn call sites do not each hit the
  // network. Semantics:
  //   - fresh hit (within TTL) → cached config (copied);
  //   - concurrent calls → share one in-flight fetch, each gets its own copy;
  //   - transient metadata failure WITH a last-good → serve stale (copied),
  //     throttled so we re-attempt `/models` at most every STALE_RETRY window;
  //   - `model_not_found` (catalog responded, model absent) → null even if a
  //     last-good exists, so a delisted/misconfigured model stays loud;
  //   - first-fetch failure (no last-good) → null, re-attempted next turn.
  // The cached object is canonical and never handed out by reference — every
  // return is a fresh shallow copy.

  async loadConfig(): Promise<InferenceConfig | null> {
    const now = Date.now();

    // 1. Fresh cache hit.
    if (this.cachedConfig && now - this.cachedAt < MODEL_CONFIG_CACHE_TTL_MS) {
      return { ...this.cachedConfig };
    }
    // 2. Concurrent dedup — await the canonical fetch, copy per caller.
    if (this.inFlight) {
      const c = await this.inFlight;
      return c ? { ...c } : null;
    }
    // 3. Throttled stale-serve: a recent metadata failure left a last-good
    //    config and we're inside the retry window — serve stale without a
    //    network call.
    if (this.cachedConfig && now < this.staleServeUntil) {
      return { ...this.cachedConfig };
    }

    // 4. Fetch. The stored promise resolves to the CANONICAL reference (or
    //    null) — never a copy — so all awaiters clone independently.
    this.inFlight = this._fetchConfig()
      .then((result) => {
        if (result.kind === "success") {
          this.cachedConfig = result.config;
          this.cachedAt = Date.now();
          this.staleServeUntil = 0;
          return this.cachedConfig;
        }
        if (result.kind === "metadata_unavailable" && this.cachedConfig) {
          // Transient `/models` failure but we have a last-good — serve it and
          // throttle the next refetch attempt so we don't block every turn.
          this.staleServeUntil = Date.now() + MODEL_CONFIG_STALE_RETRY_MS;
          logger.warn("inference.openrouter.config_stale_served", {
            model: this.model,
            cachedAt: new Date(this.cachedAt).toISOString(),
          });
          return this.cachedConfig;
        }
        // `model_not_found` (surface delisting/misconfig), or metadata failure
        // with no last-good to fall back on.
        return null;
      })
      .finally(() => {
        this.inFlight = null;
      });

    // 5. Starter clones the canonical result too.
    const c = await this.inFlight;
    return c ? { ...c } : null;
  }

  // ── _fetchConfig (uncached `/models` read) ──────────────────────
  //
  // Classifies the outcome so `loadConfig()` can decide stale-vs-null:
  //   - `success`              → catalog responded and contains the primary
  //                              model, OR (issue #37) the primary was absent
  //                              but a configured, differing fallback resolved;
  //   - `model_not_found`      → catalog responded but lacks the model, and no
  //                              fallback recovered it (hard);
  //   - `metadata_unavailable` → the `/models` request itself failed.
  //
  // Model-availability failover (issue #37) is scoped EXACTLY to `model_not_found`
  // (a retired/mistyped slug). A `metadata_unavailable` transient (`/models`
  // outage) is NOT an availability miss and never triggers the fallback — masking
  // it would hide a real outage behind a silent model swap. The fallback is
  // attempted at most once (single dual-resolve over one catalog response), so
  // there is no retry loop, and on the primary each fetch is re-preferred so a
  // recovered primary auto-reverts on the next TTL refresh.

  private async _fetchConfig(): Promise<
    | { kind: "success"; config: InferenceConfig }
    | { kind: "model_not_found" }
    | { kind: "metadata_unavailable" }
  > {
    // `/models` transport/server/SDK failure → metadata_unavailable (the
    // caller may serve a last-good config). A successful catalog that lacks
    // the model is a distinct, hard `model_not_found`.
    let models: Awaited<ReturnType<typeof this.client.models.list>>;
    try {
      models = await this.client.models.list({});
    } catch (err) {
      const causeCode = extractCauseCode(err);
      logger.error("inference.openrouter.api_unreachable", {
        model: this.primaryModel,
        error: err instanceof Error ? err.message : String(err),
        ...(causeCode !== null ? { causeCode } : {}),
        hint: apiUnreachableHint(causeCode),
      });
      return { kind: "metadata_unavailable" };
    }

    // Prefer the primary model every fetch (so a recovered primary reverts).
    const primaryConfig = this.buildConfigForModel(models, this.primaryModel);
    if (primaryConfig) {
      this.activeModel = this.primaryModel;
      return { kind: "success", config: primaryConfig };
    }

    // Primary is a model-availability miss. If a differing fallback is
    // configured, resolve the request against it ONCE from the same catalog.
    if (this.fallbackModel !== null) {
      const fallbackConfig = this.buildConfigForModel(models, this.fallbackModel);
      if (fallbackConfig) {
        this.activeModel = this.fallbackModel;
        logger.warn("inference.model.fallback_used", {
          primary: this.primaryModel,
          fallback: this.fallbackModel,
        });
        return { kind: "success", config: fallbackConfig };
      }
    }

    // No fallback, or the fallback is also absent — surface the original miss
    // (unchanged `model_not_found` → null-config behavior).
    logger.error("inference.openrouter.model_not_found", {
      model: this.primaryModel,
      ...(this.fallbackModel !== null ? { fallbackAlsoMissing: this.fallbackModel } : {}),
      hint: "Check AGENT_MODEL or OpenRouter model availability",
    });
    return { kind: "model_not_found" };
  }

  // ── buildConfigForModel (pure per-model catalog resolve) ────────
  //
  // Resolve one model id against an already-fetched `/models` catalog: returns
  // its priced {@link InferenceConfig} (and logs `config_loaded`) when present,
  // or `null` when the catalog lacks it. No network — the caller owns the fetch
  // — so the primary and the fallback are resolved from ONE catalog response.

  private buildConfigForModel(
    models: Awaited<ReturnType<typeof this.client.models.list>>,
    model: string,
  ): InferenceConfig | null {
    const found = models.data?.find((m: { id: string }) => m.id === model);
    if (!found) return null;

    let inputPricePerM = 0;
    let outputPricePerM = 0;
    let cachePricePerM: number | null = null;
    let cacheWritePricePerM: number | null = null;
    let reasoningPricePerM: number | null = null;

    if (found.pricing) {
      // PublicPricing: prompt/completion are per-TOKEN strings (not per-1M).
      // A malformed/non-numeric price must NOT poison cost math as NaN — guard
      // each parse so a bad value falls back to 0 (required prices) or null
      // (optional prices).
      inputPricePerM = parsePricePerM(found.pricing.prompt) ?? 0;
      outputPricePerM = parsePricePerM(found.pricing.completion) ?? 0;
      cachePricePerM = parsePricePerM(found.pricing.inputCacheRead);
      cacheWritePricePerM = parsePricePerM(found.pricing.inputCacheWrite);
      reasoningPricePerM = parsePricePerM(found.pricing.internalReasoning);
    }

    logger.info("inference.openrouter.config_loaded", {
      model,
      contextLimit: this.contextLimit,
      inputPricePerM: inputPricePerM.toFixed(4),
      outputPricePerM: outputPricePerM.toFixed(4),
      hasCachePrice: cachePricePerM !== null,
      hasReasoningPrice: reasoningPricePerM !== null,
    });

    return {
      provider: this.id,
      model,
      contextLimit: this.contextLimit,
      temperature: this.temperature,
      maxOutputTokens: this.maxOutputTokens,
      inputPricePerM,
      outputPricePerM,
      priceCurrency: "USD",
      cachePricePerM,
      cacheWritePricePerM,
      reasoningPricePerM,
    };
  }

  // ── chatCompletion (non-streaming, with tools) ──────────────────

  async chatCompletion(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): Promise<InferenceResponse> {
    const params = buildOpenRouterParams(messages, tools, config, false);

    let response: ChatResult;
    try {
      // `stream: false` selects the non-streaming `ChatResult` overload — no cast.
      response = await this.client.chat.send({
        chatRequest: { ...params, stream: false },
      });
    } catch (err) {
      throw normalizeOpenRouterError(err, "chat completion");
    }

    return parseNonStreamingResponse(response);
  }

  // ── chatCompletionSimple (no tools) ─────────────────────────────

  async chatCompletionSimple(
    messages: ProviderMessage[],
    config: InferenceConfig,
    responseFormat?: ChatRequest["responseFormat"],
  ): Promise<{ content: string; usage: InferenceUsage }> {
    const params = buildOpenRouterParams(messages, [], config, false, responseFormat);

    // When a structured `responseFormat` is requested (F31 judge, Layer B),
    // pin `provider.requireParameters: true` so the request routes ONLY to
    // endpoints that honor the format and FAILS LOUD (job retries) instead of
    // silently returning prose. `allowFallbacks` stays default true, so a
    // provider OUTAGE still falls back — but only among honoring endpoints.
    // Callers that pass no `responseFormat` send a byte-identical wire request.
    const provider: ChatRequest["provider"] =
      responseFormat !== undefined ? { requireParameters: true } : undefined;

    let response: ChatResult;
    try {
      // `stream: false` selects the non-streaming `ChatResult` overload — no cast.
      response = await this.client.chat.send({
        chatRequest: { ...params, stream: false, ...(provider && { provider }) },
      });
    } catch (err) {
      throw normalizeOpenRouterError(err, "simple chat completion");
    }

    const msg = response.choices?.[0]?.message;
    const content = typeof msg?.content === "string" ? msg.content : "";

    return {
      content,
      usage: extractUsage(response.usage),
    };
  }

  // ── chatCompletionStream (streaming with tools) ─────────────────

  async *chatCompletionStream(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const params = buildOpenRouterParams(messages, tools, config, true);

    let stream: EventStream<ChatStreamChunk>;
    try {
      // `signal` is a flattened RequestInit field on the SDK's RequestOptions
      // (takes precedence over the client timeout); it cancels the fetch so a
      // chat-turn "stop generating" tears down the HTTP stream (Stage 9-5a).
      // `stream: true` selects the `EventStream<ChatStreamChunk>` overload — no cast.
      stream = await this.client.chat.send(
        { chatRequest: { ...params, stream: true } },
        signal ? { signal } : undefined,
      );
    } catch (err) {
      throw normalizeOpenRouterError(err, "streaming chat completion");
    }

    try {
      // Post-first-chunk (mid-stream) rejections from the async iterator
      // (dropped connection, upstream disconnect) reach here OUTSIDE the
      // `client.chat.send` try/catch above — normalize them the same way so
      // the classifier's own-property signals and the redactor both apply
      // (a raw SDK rejection would otherwise bypass classification metadata
      // AND message redaction).
      yield* consumeOpenRouterStream(stream);
    } catch (err) {
      throw normalizeOpenRouterError(err, "streaming chat completion (mid-stream)");
    }
  }

  // ── getBalance ──────────────────────────────────────────────────

  async getBalance(): Promise<ProviderBalance | null> {
    // Try management key endpoint first (richer data)
    try {
      const res = await this.client.credits.getCredits();
      const total = res.data?.totalCredits ?? 0;
      const used = res.data?.totalUsage ?? 0;
      const remaining = total - used;
      const isLow = remaining < OPENROUTER_LOW_BALANCE_USD;

      return {
        available: remaining,
        currency: "USD",
        isLow,
        displayText: `$${remaining.toFixed(2)} USD`,
        total,
      };
    } catch {
      // Management key not available — try regular key metadata
    }

    // Fallback: getCurrentKeyMetadata (works with regular inference keys)
    try {
      const keyInfo = await this.client.apiKeys.getCurrentKeyMetadata();
      const data = keyInfo.data;
      const limit = data?.limit ?? null;
      const limitRemaining = data?.limitRemaining ?? null;

      if (limit != null && limitRemaining != null) {
        const isLow = limitRemaining < OPENROUTER_LOW_BALANCE_USD;
        return {
          available: limitRemaining,
          currency: "USD",
          isLow,
          displayText: `$${limitRemaining.toFixed(2)} USD (limit: $${limit.toFixed(2)})`,
          total: limit,
          usageDaily: data?.usageDaily,
          usageMonthly: data?.usageMonthly,
        };
      }

      // Key has no spending limit — balance unknown but not low
      return null;
    } catch {
      return null;
    }
  }

  // ── calculateCost ───────────────────────────────────────────────
  //
  // Delegates to the pure `computeRequestCost` (testable without a provider
  // instance). It prefers OpenRouter's authoritative `usage.cost` and falls
  // back to the local price-table estimate when that value is absent/invalid.

  calculateCost(usage: InferenceUsage, config: InferenceConfig): RequestCost {
    return computeRequestCost(usage, config);
  }

}
