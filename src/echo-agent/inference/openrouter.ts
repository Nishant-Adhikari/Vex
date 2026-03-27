/**
 * OpenRouter inference provider — SDK-based with streaming + tool calling.
 *
 * Uses @openrouter/sdk for all communication. SDK handles:
 * - Retry with backoff (429, 5xx)
 * - Timeout management
 * - Auth header injection
 * - Zod-validated response parsing
 *
 * Streaming: SDK returns EventStream<ChatStreamingResponseChunk> which
 * we consume and yield as provider-agnostic StreamChunk instances.
 *
 * Tool calling: both streaming (delta accumulation) and non-streaming paths.
 *
 * @see https://openrouter.ai/docs/quickstart
 */

import { OpenRouter } from "@openrouter/sdk";
import type { ChatResponse } from "@openrouter/sdk/models/chatresponse.js";
import type { ChatGenerationParams } from "@openrouter/sdk/models/chatgenerationparams.js";
import type { ChatMessageToolCall } from "@openrouter/sdk/models/chatmessagetoolcall.js";
import type { ChatStreamingResponseChunk } from "@openrouter/sdk/models/chatstreamingresponsechunk.js";
import type { ChatStreamingMessageToolCall } from "@openrouter/sdk/models/chatstreamingmessagetoolcall.js";
import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";

import type {
  InferenceProvider,
  InferenceConfig,
  InferenceResponse,
  InferenceUsage,
  ParsedToolCall,
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
  OPENROUTER_APP_CATEGORY,
  OPENROUTER_SDK_TIMEOUT_MS,
  OPENROUTER_LOW_BALANCE_USD,
} from "./config.js";

import logger from "@utils/logger.js";

// ── Provider ─────────────────────────────────────────────────────

export class OpenRouterProvider implements InferenceProvider {
  readonly id = "openrouter";
  readonly displayName = "OpenRouter";

  private readonly apiKey: string;
  private readonly model: string;
  private readonly contextLimit: number;
  private readonly temperature: number | undefined;
  private readonly maxOutputTokens: number;
  private readonly client: OpenRouter;

  constructor() {
    const env = loadEnvConfig();

    if (!env.openrouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is required for OpenRouter provider");
    }
    if (!env.agentModel) {
      throw new Error("AGENT_MODEL is required for OpenRouter provider");
    }

    this.apiKey = env.openrouterApiKey;
    this.model = env.agentModel;
    this.contextLimit = env.contextLimit;
    this.temperature = env.temperature ?? undefined;
    this.maxOutputTokens = env.maxOutputTokens;

    this.client = new OpenRouter({
      apiKey: this.apiKey,
      httpReferer: OPENROUTER_APP_URL,
      xTitle: OPENROUTER_APP_TITLE,
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

  // ── loadConfig ──────────────────────────────────────────────────

  async loadConfig(): Promise<InferenceConfig | null> {
    let inputPricePerM = 0;
    let outputPricePerM = 0;
    let cachePricePerM: number | null = null;
    let reasoningPricePerM: number | null = null;

    try {
      const models = await this.client.models.list({});
      const found = models.data?.find((m: { id: string }) => m.id === this.model);

      if (!found) {
        logger.error("inference.openrouter.model_not_found", {
          model: this.model,
          hint: "Check AGENT_MODEL or OpenRouter model availability",
        });
        return null;
      }

      if (found.pricing) {
        // PublicPricing: prompt/completion are per-TOKEN strings (not per-1M)
        inputPricePerM = parseFloat(String(found.pricing.prompt)) * 1_000_000;
        outputPricePerM = parseFloat(String(found.pricing.completion)) * 1_000_000;

        if (found.pricing.inputCacheRead) {
          cachePricePerM = parseFloat(String(found.pricing.inputCacheRead)) * 1_000_000;
        }
        if (found.pricing.internalReasoning) {
          reasoningPricePerM = parseFloat(String(found.pricing.internalReasoning)) * 1_000_000;
        }
      }

      logger.info("inference.openrouter.config_loaded", {
        model: this.model,
        contextLimit: this.contextLimit,
        inputPricePerM: inputPricePerM.toFixed(4),
        outputPricePerM: outputPricePerM.toFixed(4),
        hasCachePrice: cachePricePerM !== null,
        hasReasoningPrice: reasoningPricePerM !== null,
      });
    } catch (err) {
      logger.error("inference.openrouter.api_unreachable", {
        model: this.model,
        error: err instanceof Error ? err.message : String(err),
        hint: "Check OPENROUTER_API_KEY and network connectivity",
      });
      return null;
    }

    return {
      provider: this.id,
      model: this.model,
      contextLimit: this.contextLimit,
      temperature: this.temperature,
      maxOutputTokens: this.maxOutputTokens,
      inputPricePerM,
      outputPricePerM,
      priceCurrency: "USD",
      cachePricePerM,
      reasoningPricePerM,
    };
  }

  // ── chatCompletion (non-streaming, with tools) ──────────────────

  async chatCompletion(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
  ): Promise<InferenceResponse> {
    const params = this.buildParams(messages, tools, config, false);

    const response = await this.client.chat.send({
      chatGenerationParams: params,
    }) as ChatResponse;

    return parseNonStreamingResponse(response);
  }

  // ── chatCompletionSimple (no tools) ─────────────────────────────

  async chatCompletionSimple(
    messages: ProviderMessage[],
    config: InferenceConfig,
  ): Promise<{ content: string; usage: InferenceUsage }> {
    const params = this.buildParams(messages, [], config, false);

    const response = await this.client.chat.send({
      chatGenerationParams: params,
    }) as ChatResponse;

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
  ): AsyncGenerator<StreamChunk> {
    const params = this.buildParams(messages, tools, config, true);

    const stream = await this.client.chat.send({
      chatGenerationParams: { ...params, stream: true },
    }) as EventStream<ChatStreamingResponseChunk>;

    // Accumulate tool call deltas by index
    const toolCallAccumulator = new Map<number, {
      id: string;
      name: string;
      argsBuffer: string;
    }>();

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;

      // Error on chunk
      if (chunk.error) {
        yield {
          type: "error",
          errorMessage: chunk.error.message,
          errorCode: chunk.error.code,
        };
        continue;
      }

      // Text content delta
      if (delta?.content) {
        yield { type: "content", text: delta.content };
      }

      // Reasoning delta
      if (delta?.reasoning) {
        yield { type: "reasoning", reasoningText: delta.reasoning };
      }

      // Tool call deltas — accumulate by index
      if (delta?.toolCalls) {
        for (const tc of delta.toolCalls) {
          yield* processToolCallDelta(tc, toolCallAccumulator);
        }
      }

      // Usage (typically in last chunk)
      if (chunk.usage) {
        yield { type: "usage", usage: extractUsage(chunk.usage) };
      }

      // Check finish reason
      const finishReason = chunk.choices?.[0]?.finishReason;
      if (finishReason === "stop" || finishReason === "tool_calls") {
        // Yield final parsed tool calls if accumulated
        // (done event signals completion — engine assembles final tool calls)
        yield { type: "done" };
      }
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

  calculateCost(usage: InferenceUsage, config: InferenceConfig): RequestCost {
    const promptCost = (usage.promptTokens / 1_000_000) * config.inputPricePerM;
    const completionCost = (usage.completionTokens / 1_000_000) * config.outputPricePerM;

    let cachedSavings = 0;
    if (config.cachePricePerM !== null && usage.cachedTokens && usage.cachedTokens > 0) {
      const standardCost = (usage.cachedTokens / 1_000_000) * config.inputPricePerM;
      const cacheCost = (usage.cachedTokens / 1_000_000) * config.cachePricePerM;
      cachedSavings = standardCost - cacheCost;
    }

    let reasoningCost = 0;
    if (config.reasoningPricePerM !== null && usage.reasoningTokens && usage.reasoningTokens > 0) {
      const standardCost = (usage.reasoningTokens / 1_000_000) * config.outputPricePerM;
      const actualCost = (usage.reasoningTokens / 1_000_000) * config.reasoningPricePerM;
      reasoningCost = actualCost - standardCost;
    }

    const totalCost = promptCost + completionCost - cachedSavings + reasoningCost;

    return {
      totalCost,
      currency: "USD",
      breakdown: { promptCost, completionCost, cachedSavings, reasoningCost },
    };
  }

  // ── Private helpers ─────────────────────────────────────────────

  private buildParams(
    messages: ProviderMessage[],
    tools: ToolDefinition[],
    config: InferenceConfig,
    stream: boolean,
  ): ChatGenerationParams {
    const params: ChatGenerationParams = {
      model: config.model,
      messages: mapMessages(messages),
      maxTokens: config.maxOutputTokens,
      ...(config.temperature !== undefined && { temperature: config.temperature }),
      ...(stream && { stream: true }),
    };

    if (tools.length > 0) {
      params.tools = tools.map(t => ({
        type: "function" as const,
        function: {
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        },
      }));
      params.toolChoice = "auto";
    }

    return params;
  }
}

// ── Message mapping ──────────────────────────────────────────────

function mapMessages(messages: ProviderMessage[]): ChatGenerationParams["messages"] {
  return messages.map(m => {
    if (m.role === "tool" && m.toolCallId) {
      return { role: "tool" as const, content: m.content, toolCallId: m.toolCallId };
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant" as const,
        content: m.content || undefined,
        toolCalls: m.toolCalls.map(tc => ({
          id: tc.id ?? "",
          type: "function" as const,
          function: { name: tc.command, arguments: JSON.stringify(tc.args) },
        })),
      };
    }

    if (m.role === "system") return { role: "system" as const, content: m.content };
    if (m.role === "assistant") return { role: "assistant" as const, content: m.content || undefined };
    return { role: "user" as const, content: m.content };
  });
}

// ── Response parsing ─────────────────────────────────────────────

function extractUsage(raw: { promptTokens?: number; completionTokens?: number; totalTokens?: number; completionTokensDetails?: { reasoningTokens?: number | null } | null; promptTokensDetails?: { cachedTokens?: number } | null } | undefined): InferenceUsage {
  return {
    promptTokens: raw?.promptTokens ?? 0,
    completionTokens: raw?.completionTokens ?? 0,
    totalTokens: raw?.totalTokens ?? 0,
    cachedTokens: raw?.promptTokensDetails?.cachedTokens ?? undefined,
    reasoningTokens: raw?.completionTokensDetails?.reasoningTokens ?? undefined,
  };
}

function parseNonStreamingResponse(response: ChatResponse): InferenceResponse {
  const choice = response.choices?.[0];
  const msg = choice?.message;
  const usage = extractUsage(response.usage);

  // Tool calls
  const sdkToolCalls: ChatMessageToolCall[] | undefined = msg?.toolCalls;
  if (sdkToolCalls?.length) {
    const parsed: ParsedToolCall[] = [];
    for (const tc of sdkToolCalls) {
      try {
        parsed.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        });
      } catch {
        logger.warn("inference.openrouter.malformed_tool_args", {
          name: tc.function.name,
          raw: tc.function.arguments.slice(0, 200),
        });
      }
    }
    if (parsed.length > 0) {
      return {
        content: typeof msg?.content === "string" ? msg.content : null,
        toolCalls: parsed,
        usage,
        reasoning: msg?.reasoning ?? null,
      };
    }
  }

  // Text response
  const content = typeof msg?.content === "string" ? msg.content : "";
  return {
    content,
    toolCalls: null,
    usage,
    reasoning: msg?.reasoning ?? null,
  };
}

// ── Streaming tool call delta accumulation ────────────────────────

function* processToolCallDelta(
  tc: ChatStreamingMessageToolCall,
  accumulator: Map<number, { id: string; name: string; argsBuffer: string }>,
): Generator<StreamChunk> {
  const idx = tc.index;

  if (!accumulator.has(idx)) {
    accumulator.set(idx, { id: tc.id ?? "", name: "", argsBuffer: "" });
  }

  const acc = accumulator.get(idx)!;

  if (tc.id) acc.id = tc.id;
  if (tc.function?.name) acc.name = tc.function.name;

  const chunk: StreamChunk = {
    type: "tool_call_delta",
    toolCallIndex: idx,
  };

  // First chunk for this tool call — emit id + name
  if (tc.id) chunk.toolCallId = tc.id;
  if (tc.function?.name) chunk.toolCallName = tc.function.name;

  // Arguments delta (incremental JSON string)
  if (tc.function?.arguments) {
    acc.argsBuffer += tc.function.arguments;
    chunk.toolCallArgsDelta = tc.function.arguments;
  }

  yield chunk;
}
