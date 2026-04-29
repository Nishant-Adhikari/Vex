/**
 * 0G Compute message mapping and response parsing (OpenAI-compatible format).
 */

import type {
  InferenceResponse,
  InferenceUsage,
  ParsedToolCall,
  ProviderMessage,
} from "../types.js";

import logger from "@utils/logger.js";

// ── OpenAI-compatible response types ─────────────────────────────

export interface OpenAIResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

// ── Message mapping ──────────────────────────────────────────────

export interface OpenAIMessage {
  role: string;
  content: string | null;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

export function mapMessagesToOpenAI(messages: ProviderMessage[]): OpenAIMessage[] {
  return messages.map(m => {
    if (m.role === "tool" && m.toolCallId) {
      return { role: "tool", content: m.content, tool_call_id: m.toolCallId };
    }

    if (m.role === "assistant" && m.toolCalls?.length) {
      return {
        role: "assistant",
        content: m.content || null,
        tool_calls: m.toolCalls.map(tc => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.command, arguments: JSON.stringify(tc.args) },
        })),
      };
    }

    return { role: m.role, content: m.content };
  });
}

// ── Response parsing ─────────────────────────────────────────────

export function parseOpenAIResponse(json: OpenAIResponse): InferenceResponse {
  const choice = json.choices?.[0];
  const msg = choice?.message;
  const usage: InferenceUsage = {
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    totalTokens: (json.usage?.prompt_tokens ?? 0) + (json.usage?.completion_tokens ?? 0),
  };

  // Tool calls
  if (msg?.tool_calls?.length) {
    const toolCalls: ParsedToolCall[] = [];
    for (const tc of msg.tool_calls) {
      try {
        toolCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: JSON.parse(tc.function.arguments),
        });
      } catch {
        logger.warn("inference.0g.malformed_tool_args", {
          name: tc.function.name,
          raw: tc.function.arguments.slice(0, 200),
        });
      }
    }
    if (toolCalls.length > 0) {
      return { content: null, toolCalls, usage };
    }
  }

  // Text response
  return {
    content: msg?.content ?? "",
    toolCalls: null,
    usage,
  };
}
