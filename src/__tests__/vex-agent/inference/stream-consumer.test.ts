import { describe, expect, it, vi } from "vitest";

import { runStreamingInference } from "@vex-agent/inference/stream-consumer.js";
import type {
  InferenceConfig,
  InferenceProvider,
  InferenceResponse,
  ProviderMessage,
  StreamChunk,
  ToolDefinition,
} from "@vex-agent/inference/types.js";

const MSGS: ProviderMessage[] = [];
const TOOLS: ToolDefinition[] = [];
const CFG = {} as InferenceConfig;
const ZERO_USAGE = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
const USAGE = { promptTokens: 100, completionTokens: 20, totalTokens: 120 };

function fromChunks(chunks: StreamChunk[]) {
  return async function* (): AsyncGenerator<StreamChunk> {
    for (const chunk of chunks) yield chunk;
  };
}

function providerFrom(
  streamImpl: () => AsyncGenerator<StreamChunk>,
  chatCompletion = vi.fn(),
): InferenceProvider {
  return {
    id: "fake",
    chatCompletionStream: streamImpl,
    chatCompletion,
  } as unknown as InferenceProvider;
}

function run(
  chunks: StreamChunk[],
  onDelta?: (chunk: StreamChunk, sequence: number) => void,
): Promise<InferenceResponse> {
  return runStreamingInference(providerFrom(fromChunks(chunks)), MSGS, TOOLS, CFG, { onDelta });
}

describe("runStreamingInference — accumulation equivalence", () => {
  it("text-only: joins content deltas, captures usage, null reasoning/toolCalls", async () => {
    const res = await run([
      { type: "content", text: "Hello " },
      { type: "content", text: "world" },
      { type: "usage", usage: USAGE },
      { type: "done" },
    ]);
    expect(res).toEqual({ content: "Hello world", toolCalls: null, usage: USAGE, reasoning: null });
  });

  it("tool-only: assembles a parsed tool call, content is null", async () => {
    const res = await run([
      { type: "tool_call_delta", toolCallIndex: 0, toolCallId: "call-1", toolCallName: "transfer" },
      { type: "tool_call_delta", toolCallIndex: 0, toolCallArgsDelta: '{"to":"0x1"' },
      { type: "tool_call_delta", toolCallIndex: 0, toolCallArgsDelta: "}" },
      { type: "usage", usage: USAGE },
      { type: "done" },
    ]);
    expect(res).toEqual({
      content: null,
      toolCalls: [{ id: "call-1", name: "transfer", arguments: { to: "0x1" } }],
      usage: USAGE,
      reasoning: null,
    });
  });

  it("mixed text + tools: content kept, no usage chunk → zeroed usage", async () => {
    const res = await run([
      { type: "content", text: "Sure " },
      { type: "tool_call_delta", toolCallIndex: 0, toolCallId: "c1", toolCallName: "t", toolCallArgsDelta: "{}" },
      { type: "done" },
    ]);
    expect(res).toEqual({
      content: "Sure ",
      toolCalls: [{ id: "c1", name: "t", arguments: {} }],
      usage: ZERO_USAGE,
      reasoning: null,
    });
  });

  it("reasoning + content: reasoning joined alongside content", async () => {
    const res = await run([
      { type: "reasoning", reasoningText: "think " },
      { type: "reasoning", reasoningText: "more" },
      { type: "content", text: "answer" },
      { type: "done" },
    ]);
    expect(res).toEqual({ content: "answer", toolCalls: null, usage: ZERO_USAGE, reasoning: "think more" });
  });

  it("reasoning-only: content is empty string, toolCalls null", async () => {
    const res = await run([
      { type: "reasoning", reasoningText: "just thinking" },
      { type: "done" },
    ]);
    expect(res).toEqual({ content: "", toolCalls: null, usage: ZERO_USAGE, reasoning: "just thinking" });
  });

  it("stream ends without a done chunk: still assembles", async () => {
    const res = await run([{ type: "content", text: "x" }]);
    expect(res).toEqual({ content: "x", toolCalls: null, usage: ZERO_USAGE, reasoning: null });
  });

  it("trailing usage after done is not lost (assembly on exhaustion)", async () => {
    const res = await run([
      { type: "content", text: "a" },
      { type: "done" },
      { type: "usage", usage: USAGE },
      { type: "done" },
    ]);
    expect(res).toEqual({ content: "a", toolCalls: null, usage: USAGE, reasoning: null });
  });

  it("non-contiguous tool indices: parsed in numeric index order", async () => {
    const res = await run([
      { type: "tool_call_delta", toolCallIndex: 1, toolCallId: "c-b", toolCallName: "beta", toolCallArgsDelta: '{"b":2}' },
      { type: "tool_call_delta", toolCallIndex: 0, toolCallId: "c-a", toolCallName: "alpha", toolCallArgsDelta: '{"a":1}' },
      { type: "done" },
    ]);
    expect(res.toolCalls).toEqual([
      { id: "c-a", name: "alpha", arguments: { a: 1 } },
      { id: "c-b", name: "beta", arguments: { b: 2 } },
    ]);
  });

  it("all tool args malformed → falls through to text semantics", async () => {
    const res = await run([
      { type: "tool_call_delta", toolCallIndex: 0, toolCallId: "c1", toolCallName: "t", toolCallArgsDelta: "not json" },
      { type: "done" },
    ]);
    expect(res).toEqual({ content: "", toolCalls: null, usage: ZERO_USAGE, reasoning: null });
  });

  it("partially malformed tool args → only valid calls survive (tool path)", async () => {
    const res = await run([
      { type: "tool_call_delta", toolCallIndex: 0, toolCallId: "c0", toolCallName: "good", toolCallArgsDelta: '{"ok":1}' },
      { type: "tool_call_delta", toolCallIndex: 1, toolCallId: "c1", toolCallName: "bad", toolCallArgsDelta: "oops" },
      { type: "done" },
    ]);
    expect(res).toEqual({
      content: null,
      toolCalls: [{ id: "c0", name: "good", arguments: { ok: 1 } }],
      usage: ZERO_USAGE,
      reasoning: null,
    });
  });
});

describe("runStreamingInference — onDelta", () => {
  it("invokes onDelta once per chunk in order with a monotonic sequence", async () => {
    const seen: Array<{ type: string; seq: number }> = [];
    await run(
      [
        { type: "content", text: "a" },
        { type: "content", text: "b" },
        { type: "done" },
      ],
      (chunk, sequence) => seen.push({ type: chunk.type, seq: sequence }),
    );
    expect(seen).toEqual([
      { type: "content", seq: 0 },
      { type: "content", seq: 1 },
      { type: "done", seq: 2 },
    ]);
  });

  it("a throwing onDelta never affects the assembled result", async () => {
    const res = await run(
      [
        { type: "content", text: "ok" },
        { type: "done" },
      ],
      () => {
        throw new Error("observer blew up");
      },
    );
    expect(res).toEqual({ content: "ok", toolCalls: null, usage: ZERO_USAGE, reasoning: null });
  });
});

describe("runStreamingInference — error chunks (no fallback)", () => {
  it("emits a first error chunk then throws, without calling chatCompletion", async () => {
    const chatCompletion = vi.fn();
    const onDelta = vi.fn();
    const provider = providerFrom(
      fromChunks([{ type: "error", errorMessage: "rate limited", errorCode: 429 }]),
      chatCompletion,
    );
    await expect(
      runStreamingInference(provider, MSGS, TOOLS, CFG, { onDelta }),
    ).rejects.toThrow("rate limited");
    expect(onDelta).toHaveBeenCalledTimes(1);
    expect(onDelta.mock.calls[0]?.[0]).toMatchObject({ type: "error" });
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("throws on a mid-stream error chunk", async () => {
    const chatCompletion = vi.fn();
    const provider = providerFrom(
      fromChunks([
        { type: "content", text: "partial" },
        { type: "error", errorMessage: "boom" },
      ]),
      chatCompletion,
    );
    await expect(runStreamingInference(provider, MSGS, TOOLS, CFG)).rejects.toThrow("boom");
    expect(chatCompletion).not.toHaveBeenCalled();
  });

  it("re-throws a generator rejection that happens after the first chunk", async () => {
    const chatCompletion = vi.fn();
    const provider = providerFrom(async function* (): AsyncGenerator<StreamChunk> {
      yield { type: "content", text: "a" };
      throw new Error("mid-stream reject");
    }, chatCompletion);
    await expect(runStreamingInference(provider, MSGS, TOOLS, CFG)).rejects.toThrow("mid-stream reject");
    expect(chatCompletion).not.toHaveBeenCalled();
  });
});

describe("runStreamingInference — fallback to chatCompletion", () => {
  const FALLBACK: InferenceResponse = {
    content: "buffered",
    toolCalls: null,
    usage: USAGE,
    reasoning: null,
  };

  it("falls back when the provider has no stream method", async () => {
    const chatCompletion = vi.fn().mockResolvedValue(FALLBACK);
    const provider = { id: "fake", chatCompletion } as unknown as InferenceProvider;
    const res = await runStreamingInference(provider, MSGS, TOOLS, CFG);
    expect(res).toBe(FALLBACK);
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it("falls back when chatCompletionStream returns a non-async-iterable", async () => {
    const chatCompletion = vi.fn().mockResolvedValue(FALLBACK);
    const provider = {
      id: "fake",
      chatCompletionStream: () => ({}),
      chatCompletion,
    } as unknown as InferenceProvider;
    const res = await runStreamingInference(provider, MSGS, TOOLS, CFG);
    expect(res).toBe(FALLBACK);
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it("falls back when the generator throws before yielding any chunk", async () => {
    const chatCompletion = vi.fn().mockResolvedValue(FALLBACK);
    const provider = providerFrom(async function* (): AsyncGenerator<StreamChunk> {
      throw new Error("setup failed");
    }, chatCompletion);
    const res = await runStreamingInference(provider, MSGS, TOOLS, CFG);
    expect(res).toBe(FALLBACK);
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });
});
