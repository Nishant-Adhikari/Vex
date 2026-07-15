/**
 * FailoverProvider — bounded retry → provider failover → clean park.
 *
 * Wraps an ORDERED list of {@link InferenceProvider}s (primary first, then
 * fallbacks) and turns a single provider blip into a survivable event instead
 * of a permanent `paused_error` halt (issue #25). Every call drives the same
 * state machine:
 *
 *   for each provider, in preference order:
 *     retry the call with exponential backoff + jitter while the error is
 *     TRANSIENT (429 / 5xx / request timeout / socket reset), up to
 *     `maxRetriesPerProvider` extra attempts;
 *     ├─ success                 → return immediately;
 *     ├─ FATAL error (4xx auth/  → throw immediately (fail fast, NO failover:
 *     │  validation, abort)         a bad key or malformed request will fail on
 *     │                             every provider and must reach the user);
 *     └─ transient budget spent  → move to the next provider (a logged switch).
 *   all providers exhausted      → throw {@link AllProvidersFailedError}, which
 *                                   is marked TRANSIENT so the mission layer
 *                                   parks in a RECOVERABLE state (auto-retry
 *                                   budget) rather than crashing or hot-looping.
 *
 * The stack is STATELESS between calls: every call restarts at the primary, so
 * a one-off failover does not stick — the primary is preferred again as soon as
 * it recovers.
 *
 * Bounded by construction: total attempts = providers.length × (1 +
 * maxRetriesPerProvider). There is no unbounded loop and no uncaught throw — a
 * RECOVER pass that re-enters this client therefore cannot re-slam a dead
 * provider or crash the app; it simply backs off, fails over, and (if still
 * unhealthy) parks cleanly again.
 *
 * DECOUPLED / upstreamable: depends only on the provider-agnostic inference
 * contract + logger. No fork-specific ($VEX / Robinhood / Vexa / Signal-Radar)
 * imports — it works on a stock upstream Vex install.
 */

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
import logger from "@utils/logger.js";

// ── Tuning defaults (technical constants, not ENV) ───────────────

const DEFAULT_MAX_RETRIES_PER_PROVIDER = 2;
const DEFAULT_BASE_DELAY_MS = 2000;
const DEFAULT_MAX_DELAY_MS = 15_000;

export interface FailoverOptions {
  /** Extra retry attempts per provider on a TRANSIENT error (initial attempt not counted). */
  maxRetriesPerProvider: number;
  /** Initial backoff delay. */
  baseDelayMs: number;
  /** Upper bound on a single backoff delay. */
  maxDelayMs: number;
  /** Add ±baseDelay jitter to spread retries (default true). */
  jitter: boolean;
  /** Injectable clock — tests pass a no-op to make backoff instant. */
  sleep: (ms: number) => Promise<void>;
  /** Injectable classifier (default {@link isTransientInferenceError}). */
  isTransient: (err: Error) => boolean;
}

// ── Error classification (transient vs fatal) ────────────────────
//
// Mirrors the CONSERVATIVE mission classifier: only clearly-transient
// provider/runtime failures retry or fail over; everything else (4xx
// auth/validation, aborts, unknown shapes) is fatal and fails fast. Status is
// read from the lean own-property `normalizeOpenRouterError` attaches — never a
// message regex first — so a 401 stays fatal even if a mapper set retryable.

const TRANSIENT_NODE_CODES: ReadonlySet<string> = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "EPIPE",
]);

/** VexError codes that represent a transient request-level failure. */
const TRANSIENT_VEX_CODES: ReadonlySet<string> = new Set(["HTTP_TIMEOUT"]);

function readField(err: Error, key: string): unknown {
  return (err as unknown as Record<string, unknown>)[key];
}

function statusOf(err: Error): number | null {
  for (const key of ["status", "statusCode"]) {
    const v = readField(err, key);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  const m = /\breturned\s+(\d{3})\b/i.exec(err.message);
  return m ? Number(m[1]) : null;
}

function isTransientStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Classify a thrown value as a transient (retry/failover) vs fatal (fail-fast)
 * inference error. Conservative: defaults to FATAL on any unrecognized shape so
 * an auth/validation/logic error can never be masked by silent retries.
 */
export function isTransientInferenceError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;

  const code = typeof readField(err, "code") === "string" ? (readField(err, "code") as string) : null;

  // Explicit request-timeout code is transient even when surfaced as AbortError.
  if (code !== null && TRANSIENT_VEX_CODES.has(code)) return true;
  // Any other abort (notably a user stop) never retries.
  if (err.name === "AbortError") return false;

  // HTTP status is authoritative and beats a contradictory retryable marker.
  const status = statusOf(err);
  if (status !== null) return isTransientStatus(status);

  // No status — honor an explicit transient marker from a mapper.
  if (readField(err, "retryable") === true) return true;

  // Socket / connection-level transient errors.
  if (code !== null && TRANSIENT_NODE_CODES.has(code)) return true;

  // Timeout races (`withTimeout`) throw a plain Error with no status/code.
  if (/\btimed out\b/i.test(err.message)) return true;

  return false;
}

// ── Terminal error ───────────────────────────────────────────────

export interface ProviderFailure {
  readonly providerId: string;
  readonly message: string;
  readonly status: number | null;
}

/**
 * Thrown when EVERY provider in the stack exhausted its transient retries. It
 * is deliberately marked TRANSIENT (`retryable` + a `statusCode`/`status` own-
 * property carrying the last transient status) so the mission auto-retry
 * classifier parks the run in a RECOVERABLE state instead of a permanent halt.
 * Carries only redacted per-provider messages (the underlying errors were
 * already normalized/scrubbed upstream) — never the raw error objects.
 */
export class AllProvidersFailedError extends Error {
  readonly name = "AllProvidersFailedError";
  /** Mission classifier reads this to keep the run recoverable. */
  readonly retryable = true;
  readonly failures: readonly ProviderFailure[];

  constructor(failures: readonly ProviderFailure[]) {
    const summary = failures
      .map((f) => `${f.providerId}${f.status !== null ? ` (status=${f.status})` : ""}`)
      .join(", ");
    super(`All inference providers failed after retries: ${summary}`);
    this.failures = failures;

    // Surface the last transient status as a lean own-property so the mission
    // classifier reads it directly (status-based, not message regex).
    const lastStatus = [...failures].reverse().find((f) => f.status !== null)?.status ?? null;
    if (lastStatus !== null) {
      Object.defineProperty(this, "statusCode", { value: lastStatus, enumerable: false });
      Object.defineProperty(this, "status", { value: lastStatus, enumerable: false });
    }
  }
}

// ── FailoverProvider ─────────────────────────────────────────────

export class FailoverProvider implements InferenceProvider {
  readonly id: string;
  readonly displayName: string;

  private readonly providers: readonly InferenceProvider[];
  private readonly opts: FailoverOptions;

  constructor(providers: InferenceProvider[], options: Partial<FailoverOptions> = {}) {
    if (providers.length === 0) {
      throw new Error("FailoverProvider requires at least one provider");
    }
    this.providers = [...providers];
    // Identity mirrors the PRIMARY so existing call sites (`provider.id`)
    // see the same value whether or not a fallback is configured.
    this.id = this.providers[0].id;
    this.displayName =
      this.providers.length === 1
        ? this.providers[0].displayName
        : `${this.providers[0].displayName} (+${this.providers.length - 1} fallback)`;
    this.opts = {
      maxRetriesPerProvider: options.maxRetriesPerProvider ?? DEFAULT_MAX_RETRIES_PER_PROVIDER,
      baseDelayMs: options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      maxDelayMs: options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      jitter: options.jitter ?? true,
      sleep: options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms))),
      isTransient: options.isTransient ?? isTransientInferenceError,
    };
  }

  /** Number of providers in the stack (1 = single provider, no failover target). */
  get size(): number {
    return this.providers.length;
  }

  // ── Central driver ──────────────────────────────────────────────
  //
  // Runs `op` against each provider in order with per-provider transient
  // backoff. Fatal errors throw immediately (fail fast, no failover); a fully
  // transient-exhausted stack throws AllProvidersFailedError. Bounded:
  // providers.length × (1 + maxRetriesPerProvider) attempts.

  private async run<T>(label: string, op: (p: InferenceProvider) => Promise<T>): Promise<T> {
    const failures: ProviderFailure[] = [];
    const single = this.providers.length === 1;

    for (let pIdx = 0; pIdx < this.providers.length; pIdx++) {
      const provider = this.providers[pIdx];
      let lastErr: Error | undefined;

      for (let attempt = 0; attempt <= this.opts.maxRetriesPerProvider; attempt++) {
        try {
          return await op(provider);
        } catch (raw) {
          const err = raw instanceof Error ? raw : new Error(String(raw));
          lastErr = err;

          // Fatal → fail fast. Do NOT retry and do NOT fail over: a bad key or
          // malformed request fails identically everywhere and must reach the user.
          if (!this.opts.isTransient(err)) {
            logger.warn("inference.failover.fatal", {
              label,
              providerId: provider.id,
              status: statusOf(err),
            });
            throw err;
          }

          // Transient with retries left → back off and retry the same provider.
          if (attempt < this.opts.maxRetriesPerProvider) {
            const delay = this.backoffDelay(attempt);
            logger.debug("inference.failover.retry", {
              label,
              providerId: provider.id,
              attempt: attempt + 1,
              delayMs: Math.round(delay),
              status: statusOf(err),
            });
            await this.opts.sleep(delay);
          }
        }
      }

      // Provider exhausted its transient budget.
      failures.push({
        providerId: provider.id,
        message: lastErr?.message ?? "unknown error",
        status: lastErr ? statusOf(lastErr) : null,
      });

      const nextProvider = this.providers[pIdx + 1];
      if (nextProvider) {
        logger.warn("inference.failover.switch", {
          label,
          from: provider.id,
          to: nextProvider.id,
          status: lastErr ? statusOf(lastErr) : null,
        });
      } else if (single) {
        // Single-provider stack: nothing to fail over to. Surface the provider's
        // own (already-normalized) transient error unchanged for backward compat.
        throw lastErr!;
      }
    }

    logger.error("inference.failover.exhausted", {
      label,
      providers: failures.map((f) => f.providerId),
    });
    throw new AllProvidersFailedError(failures);
  }

  private backoffDelay(attempt: number): number {
    const base = this.opts.baseDelayMs * Math.pow(2, attempt);
    const jitter = this.opts.jitter ? Math.random() * this.opts.baseDelayMs : 0;
    return Math.min(base + jitter, this.opts.maxDelayMs);
  }

  // ── InferenceProvider surface ───────────────────────────────────

  /**
   * Load config from the first provider that returns a non-null config. Config
   * loads are null-on-failure (not throw) and each provider serves its own
   * last-good/stale copy, so a plain first-non-null walk is the right failover.
   */
  async loadConfig(): Promise<InferenceConfig | null> {
    for (const provider of this.providers) {
      try {
        const config = await provider.loadConfig();
        if (config) return config;
      } catch (err) {
        logger.warn("inference.failover.loadConfig_failed", {
          providerId: provider.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return null;
  }

  chatCompletion(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): Promise<InferenceResponse> {
    return this.run("chatCompletion", (p) => p.chatCompletion(messages, tools, config));
  }

  chatCompletionSimple(
    messages: ProviderMessage[],
    config: InferenceConfig,
  ): Promise<{ content: string; usage: InferenceUsage }> {
    return this.run("chatCompletionSimple", (p) => p.chatCompletionSimple(messages, config));
  }

  /**
   * Streaming failover is CONNECTION-LEVEL only: a provider is tried (with
   * transient backoff) until it yields its FIRST chunk; a failure before the
   * first chunk fails over, but once bytes flow we cannot silently switch
   * providers mid-stream, so a mid-stream error propagates. Missions use the
   * non-streaming path; this method backs the interactive UI chat.
   */
  async *chatCompletionStream(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
    signal?: AbortSignal,
  ): AsyncGenerator<StreamChunk> {
    const generator = await this.run("chatCompletionStream.open", async (p) => {
      const gen = p.chatCompletionStream(messages, tools, config, signal);
      // Pull the first chunk INSIDE the retry/failover scope so a connect-time
      // transient error triggers backoff/failover instead of surfacing raw.
      const first = await gen.next();
      return { gen, first };
    });

    if (!generator.first.done) {
      yield generator.first.value;
      yield* generator.gen;
    }
  }

  /** Balance is best-effort: first provider that reports a value wins; null if none do. */
  async getBalance(): Promise<ProviderBalance | null> {
    for (const provider of this.providers) {
      try {
        const balance = await provider.getBalance();
        if (balance) return balance;
      } catch {
        // ignore — try the next provider
      }
    }
    return null;
  }

  /** Cost is a pure local computation — delegate to the primary. */
  calculateCost(usage: InferenceUsage, config: InferenceConfig): RequestCost {
    return this.providers[0].calculateCost(usage, config);
  }
}
