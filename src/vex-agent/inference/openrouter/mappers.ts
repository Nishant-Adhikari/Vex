/**
 * OpenRouter message mapping, response parsing, and streaming accumulation.
 */

import type { ChatResponse } from "@openrouter/sdk/models/chatresponse.js";
import type { ChatGenerationParams } from "@openrouter/sdk/models/chatgenerationparams.js";
import type { ChatMessageToolCall } from "@openrouter/sdk/models/chatmessagetoolcall.js";
import type { ChatStreamingMessageToolCall } from "@openrouter/sdk/models/chatstreamingmessagetoolcall.js";

import type {
  InferenceResponse,
  InferenceUsage,
  ParsedToolCall,
  StreamChunk,
  ProviderMessage,
} from "../types.js";

import logger from "@utils/logger.js";

// ── Message mapping ──────────────────────────────────────────────

export function mapMessages(messages: ProviderMessage[]): ChatGenerationParams["messages"] {
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

export function extractUsage(raw: { promptTokens?: number; completionTokens?: number; totalTokens?: number; completionTokensDetails?: { reasoningTokens?: number | null } | null; promptTokensDetails?: { cachedTokens?: number } | null } | undefined): InferenceUsage {
  return {
    promptTokens: raw?.promptTokens ?? 0,
    completionTokens: raw?.completionTokens ?? 0,
    totalTokens: raw?.totalTokens ?? 0,
    cachedTokens: raw?.promptTokensDetails?.cachedTokens ?? undefined,
    reasoningTokens: raw?.completionTokensDetails?.reasoningTokens ?? undefined,
  };
}

export function parseNonStreamingResponse(response: ChatResponse): InferenceResponse {
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

export function* processToolCallDelta(
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
