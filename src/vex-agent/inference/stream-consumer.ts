/**
 * Stream consumer (Stage 9-1) — provider-agnostic.
 *
 * Consumes an `InferenceProvider.chatCompletionStream` async generator,
 * accumulating the SAME `InferenceResponse` that `chatCompletion` would
 * return (behaviour-equivalent with `parseNonStreamingResponse`), while
 * invoking `onDelta(chunk, sequence)` once per provider chunk so callers can
 * mirror the stream onto the engine `streamDeltaBus`.
 *
 * Assembly happens on GENERATOR EXHAUSTION, not on the `done` chunk — `done`
 * is informational, so trailing chunks (e.g. a usage chunk emitted after the
 * finish reason) and repeated `done` chunks are never lost.
 *
 * Fallback (streaming is the default path):
 *  - provider has no stream method / it returns a non-async-iterable / it
 *    throws BEFORE yielding any chunk → fall back to buffered `chatCompletion`
 *    so a provider that cannot stream still completes the turn;
 *  - a provider-reported `error` chunk is NOT a setup failure — it is emitted
 *    as a delta and then thrown (never falls back), even if it is first;
 *  - any throw AFTER at least one observed chunk is re-thrown (no double
 *    inference call).
 * Every fallback logs a structured `inference.stream.fallback` warning so real
 * streaming breakage stays diagnosable instead of being silently masked.
 */

import type {
  InferenceConfig,
  InferenceProvider,
  InferenceResponse,
  InferenceUsage,
  ParsedToolCall,
  ProviderMessage,
  StreamChunk,
  ToolDefinition,
} from "./types.js";
import logger from "@utils/logger.js";

const ZERO_USAGE: InferenceUsage = {
  promptTokens: 0,
  completionTokens: 0,
  totalTokens: 0,
};

export interface RunStreamingInferenceOptions {
  /** Invoked once per provider chunk, in order, with a monotonic sequence. */
  readonly onDelta?: (chunk: StreamChunk, sequence: number) => void;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  argsBuffer: string;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<StreamChunk> {
  return (
    value != null &&
    typeof (value as AsyncIterable<StreamChunk>)[Symbol.asyncIterator] ===
      "function"
  );
}

/**
 * Assemble parsed tool calls in numeric `toolCallIndex` order (NOT Map
 * insertion order). Malformed args warn + skip, mirroring
 * `parseNonStreamingResponse`; if every call is malformed the caller falls
 * through to text semantics.
 */
function assembleToolCalls(
  accumulator: Map<number, ToolCallAccumulator>,
): ParsedToolCall[] {
  const parsed: ParsedToolCall[] = [];
  const indices = [...accumulator.keys()].sort((a, b) => a - b);
  for (const idx of indices) {
    const entry = accumulator.get(idx)!;
    try {
      parsed.push({
        id: entry.id,
        name: entry.name,
        arguments: JSON.parse(entry.argsBuffer) as Record<string, unknown>,
      });
    } catch {
      logger.warn("inference.openrouter.malformed_tool_args", {
        name: entry.name,
        raw: entry.argsBuffer.slice(0, 200),
      });
    }
  }
  return parsed;
}

function safeOnDelta(
  onDelta: RunStreamingInferenceOptions["onDelta"],
  chunk: StreamChunk,
  sequence: number,
): void {
  if (!onDelta) return;
  try {
    onDelta(chunk, sequence);
  } catch {
    // Observation must never affect the inference result, the fallback
    // choice, or error propagation.
  }
}

/**
 * Run inference via the streaming provider path, accumulating a
 * `chatCompletion`-equivalent `InferenceResponse`. See module doc for the
 * fallback + assembly contract.
 */
export async function runStreamingInference(
  provider: InferenceProvider,
  messages: ProviderMessage[],
  tools: ToolDefinition[],
  config: InferenceConfig,
  options: RunStreamingInferenceOptions = {},
): Promise<InferenceResponse> {
  const { onDelta } = options;

  if (typeof provider.chatCompletionStream !== "function") {
    logger.warn("inference.stream.fallback", {
      reason: "no_stream_method",
      provider: provider.id,
    });
    return provider.chatCompletion(messages, tools, config);
  }

  let stream: AsyncIterable<StreamChunk>;
  try {
    const candidate = provider.chatCompletionStream(messages, tools, config);
    if (!isAsyncIterable(candidate)) {
      logger.warn("inference.stream.fallback", {
        reason: "not_async_iterable",
        provider: provider.id,
      });
      return provider.chatCompletion(messages, tools, config);
    }
    stream = candidate;
  } catch (err) {
    logger.warn("inference.stream.fallback", {
      reason: "setup_threw",
      provider: provider.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return provider.chatCompletion(messages, tools, config);
  }

  let sequence = 0;
  let observedAnyChunk = false;
  let contentSeen = false;
  let contentBuffer = "";
  let reasoningSeen = false;
  let reasoningBuffer = "";
  let usage: InferenceUsage | null = null;
  const toolCallAccumulator = new Map<number, ToolCallAccumulator>();

  try {
    for await (const chunk of stream) {
      observedAnyChunk = true;
      safeOnDelta(onDelta, chunk, sequence++);

      switch (chunk.type) {
        case "content":
          contentSeen = true;
          contentBuffer += chunk.text ?? "";
          break;
        case "reasoning":
          reasoningSeen = true;
          reasoningBuffer += chunk.reasoningText ?? "";
          break;
        case "tool_call_delta": {
          const idx = chunk.toolCallIndex ?? 0;
          let entry = toolCallAccumulator.get(idx);
          if (!entry) {
            entry = { id: chunk.toolCallId ?? "", name: "", argsBuffer: "" };
            toolCallAccumulator.set(idx, entry);
          }
          if (chunk.toolCallId) entry.id = chunk.toolCallId;
          if (chunk.toolCallName) entry.name = chunk.toolCallName;
          if (chunk.toolCallArgsDelta) entry.argsBuffer += chunk.toolCallArgsDelta;
          break;
        }
        case "usage":
          if (chunk.usage) usage = chunk.usage;
          break;
        case "error":
          // Provider-reported error: the delta is already emitted above.
          // This is NOT a setup failure, so we never fall back — fail.
          throw new Error(chunk.errorMessage ?? "stream error");
        case "done":
          // Informational only — assembly happens on generator exhaustion.
          break;
      }
    }
  } catch (err) {
    if (!observedAnyChunk) {
      // The generator rejected before yielding anything — treat as a setup
      // failure and complete the turn via the buffered path.
      logger.warn("inference.stream.fallback", {
        reason: "threw_before_first_chunk",
        provider: provider.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return provider.chatCompletion(messages, tools, config);
    }
    throw err;
  }

  const resolvedUsage = usage ?? ZERO_USAGE;
  const reasoning = reasoningSeen ? reasoningBuffer : null;
  const toolCalls = assembleToolCalls(toolCallAccumulator);

  if (toolCalls.length > 0) {
    // Tool path — content is null when the model emitted no text alongside
    // the tool calls (parity with `parseNonStreamingResponse`).
    return {
      content: contentSeen ? contentBuffer : null,
      toolCalls,
      usage: resolvedUsage,
      reasoning,
    };
  }

  // Text path — content defaults to "" when no content delta arrived.
  return {
    content: contentBuffer,
    toolCalls: null,
    usage: resolvedUsage,
    reasoning,
  };
}
