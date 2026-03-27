/**
 * Inference layer types — shared contract for all providers.
 *
 * Provider-agnostic: no DB, no engine, no transport details.
 * Every provider (OpenRouter, 0G Compute) maps to these types.
 */

// ── Provider config (loaded once at startup) ─────────────────────

export interface InferenceConfig {
  /** Provider identifier: "openrouter" | "0g-compute" */
  provider: string;
  /** Model ID, e.g. "anthropic/claude-sonnet-4" */
  model: string;
  /** Context window size in tokens — from AGENT_CONTEXT_LIMIT env */
  contextLimit: number;
  /** Sampling temperature — OpenRouter only (0G ignores) */
  temperature?: number;
  /** Max output tokens per response — from AGENT_MAX_OUTPUT_TOKENS env */
  maxOutputTokens: number;
  /** Price per 1M input tokens (USD or 0G) */
  inputPricePerM: number;
  /** Price per 1M output tokens (USD or 0G) */
  outputPricePerM: number;
  /** Pricing currency */
  priceCurrency: PriceCurrency;
  /** Price per 1M cached input tokens — OpenRouter only, null for 0G */
  cachePricePerM: number | null;
  /** Price per 1M reasoning tokens — OpenRouter only, null for 0G */
  reasoningPricePerM: number | null;
}

export type PriceCurrency = "USD" | "0G";

// ── Per-request usage ────────────────────────────────────────────

export interface InferenceUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** Cached input tokens (OpenRouter) — reduces prompt cost */
  cachedTokens?: number;
  /** Reasoning tokens (OpenRouter extended thinking) — separate pricing */
  reasoningTokens?: number;
}

// ── Tool calling ─────────────────────────────────────────────────

export interface ParsedToolCall {
  /** Tool call ID — must be preserved for round-trip with provider */
  id: string;
  /** Function name */
  name: string;
  /** Parsed arguments object */
  arguments: Record<string, unknown>;
}

// ── Inference response (non-streaming) ───────────────────────────

export interface InferenceResponse {
  /** Text content — null when tool calls returned */
  content: string | null;
  /** Tool calls — null when text returned */
  toolCalls: ParsedToolCall[] | null;
  /** Token usage from this request */
  usage: InferenceUsage;
  /** Reasoning output (OpenRouter extended thinking) */
  reasoning?: string | null;
}

// ── Streaming chunk ──────────────────────────────────────────────

export type StreamChunkType =
  | "content"
  | "tool_call_delta"
  | "reasoning"
  | "usage"
  | "error"
  | "done";

export interface StreamChunk {
  type: StreamChunkType;

  // content
  text?: string;

  // tool_call_delta — streamed incrementally by index
  toolCallIndex?: number;
  toolCallId?: string;
  toolCallName?: string;
  toolCallArgsDelta?: string;

  // reasoning
  reasoningText?: string;

  // usage (final chunk)
  usage?: InferenceUsage;

  // error
  errorMessage?: string;
  errorCode?: number;
}

// ── Provider balance ─────────────────────────────────────────────

export interface ProviderBalance {
  /** Available balance for inference */
  available: number;
  /** Balance currency */
  currency: PriceCurrency;
  /** Whether below alert threshold */
  isLow: boolean;
  /** Human-readable display string, e.g. "$12.50 USD" or "44.99 0G" */
  displayText: string;
  /** Total balance (credits purchased or ledger total) */
  total?: number;
  /** Locked/committed balance (0G sub-account) */
  locked?: number;
  /** Daily usage — OpenRouter only */
  usageDaily?: number;
  /** Monthly usage — OpenRouter only */
  usageMonthly?: number;
}

// ── Request cost breakdown ───────────────────────────────────────

export interface RequestCost {
  /** Total cost for this request */
  totalCost: number;
  /** Cost currency */
  currency: PriceCurrency;
  /** Detailed breakdown */
  breakdown: {
    /** Cost for prompt tokens (standard rate) */
    promptCost: number;
    /** Cost for completion tokens (standard rate) */
    completionCost: number;
    /** Amount saved due to cached tokens (positive = savings) */
    cachedSavings: number;
    /** Additional cost for reasoning tokens above standard completion rate */
    reasoningCost: number;
  };
}

// ── Messages (provider-agnostic) ─────────────────────────────────

export type ProviderMessageRole = "system" | "user" | "assistant" | "tool";

export interface ProviderMessage {
  role: ProviderMessageRole;
  content: string;
  /** For tool result messages: links back to the tool call */
  toolCallId?: string;
  /** For assistant messages: tool calls made in this turn */
  toolCalls?: ProviderToolCallRef[];
}

export interface ProviderToolCallRef {
  id: string;
  command: string;
  args: Record<string, unknown>;
}

// ── Tool definition (OpenAI-compatible) ──────────────────────────

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

// ── Provider interface ───────────────────────────────────────────

export interface InferenceProvider {
  readonly id: string;
  readonly displayName: string;

  /**
   * Load inference configuration (model, pricing, context limit).
   * Returns null if provider is not configured or unavailable.
   * Called once at startup — fail fast on misconfiguration.
   */
  loadConfig(): Promise<InferenceConfig | null>;

  /**
   * Non-streaming chat completion with tool calling.
   * Used by: inference loop (tool calling round-trip).
   */
  chatCompletion(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): Promise<InferenceResponse>;

  /**
   * Simple non-streaming completion without tools.
   * Used by: compaction, session summary, Echo Papa.
   */
  chatCompletionSimple(
    messages: ProviderMessage[],
    config: InferenceConfig,
  ): Promise<{ content: string; usage: InferenceUsage }>;

  /**
   * Streaming chat completion with tool calling.
   * Used by: UI chat (text deltas + tool call deltas).
   * 0G Compute: fallback to non-streaming, yields single chunk.
   */
  chatCompletionStream(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): AsyncGenerator<StreamChunk>;

  /**
   * Get current provider balance/credit state.
   * Returns null if provider doesn't expose balance.
   */
  getBalance(): Promise<ProviderBalance | null>;

  /**
   * Calculate cost for a single request using provider-specific pricing.
   * OpenRouter: accounts for cache and reasoning pricing.
   * 0G: simple prompt + completion calculation.
   */
  calculateCost(usage: InferenceUsage, config: InferenceConfig): RequestCost;
}
