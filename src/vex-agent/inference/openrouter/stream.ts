/**
 * OpenRouter post-SDK stream-consumption loop.
 *
 * Consumes the SDK's `EventStream<ChatStreamChunk>` (returned by
 * `client.chat.send` with `stream: true`) and yields provider-agnostic
 * `StreamChunk` instances. The tool-call delta accumulation lives here; the
 * provider's `chatCompletionStream` method performs the SDK send (with error
 * normalization) and delegates the consumption loop to this function.
 */

import type { ChatStreamChunk } from "@openrouter/sdk/models/chatstreamchunk.js";
import type { EventStream } from "@openrouter/sdk/lib/event-streams.js";

import type { StreamChunk } from "../types.js";

import { extractUsage, processToolCallDelta } from "./mappers.js";

export async function* consumeOpenRouterStream(
  stream: EventStream<ChatStreamChunk>,
): AsyncGenerator<StreamChunk> {
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
