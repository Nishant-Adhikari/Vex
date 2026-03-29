/**
 * Single turn — one inference round-trip.
 *
 * Builds prompt stack, calls provider.chatCompletion(), parses
 * response, saves messages, logs usage + updates tokenCount.
 */

import type { EngineContext, TurnResult, MessageMetadata } from "../types.js";
import type { InferenceProvider, InferenceConfig, InferenceResponse, ProviderMessage, ParsedToolCall, ToolDefinition } from "@echo-agent/inference/types.js";
import type { Message } from "@echo-agent/db/repos/messages.js";
import { buildPromptStack, type PromptStackOptions } from "../prompts/index.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import * as usageRepo from "@echo-agent/db/repos/usage.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";

export interface SingleTurnResult {
  /** Text content from model — null when only tool calls. */
  content: string | null;
  /** Tool calls from model — null when text only. */
  toolCalls: ParsedToolCall[] | null;
  /** Token usage from this request. */
  promptTokens: number;
}

/**
 * Execute a single inference turn.
 *
 * 1. Build prompt stack
 * 2. Convert messages to provider format
 * 3. Call provider.chatCompletion()
 * 4. Save assistant message
 * 5. Log usage + update tokenCount
 */
export async function executeTurn(
  context: EngineContext,
  existingMessages: Message[],
  summary: string | null,
  provider: InferenceProvider,
  config: InferenceConfig,
  tools: ToolDefinition[],
  promptOptions: PromptStackOptions = {},
): Promise<SingleTurnResult> {
  // Build prompt
  const promptLayers = buildPromptStack(context, promptOptions);
  const systemPrompt = promptLayers.join("\n\n---\n\n");

  // Convert to provider format
  const providerMessages = buildProviderMessages(systemPrompt, summary, existingMessages);

  // Inference
  const response = await provider.chatCompletion(providerMessages, tools, config);

  // Save assistant message
  await saveAssistantMessage(context.sessionId, response);

  // Log usage + update token count
  const promptTokens = response.usage.promptTokens ?? 0;
  const completionTokens = response.usage.completionTokens ?? 0;

  await usageRepo.logUsage(context.sessionId, {
    promptTokens,
    completionTokens,
    cachedTokens: response.usage.cachedTokens ?? 0,
    reasoningTokens: response.usage.reasoningTokens ?? 0,
    cost: provider.calculateCost(response.usage, config).totalCost,
    provider: config.provider,
    model: config.model,
    currency: provider.calculateCost(response.usage, config).currency,
  });

  await sessionsRepo.updateTokenCount(context.sessionId, promptTokens);

  return {
    content: response.content,
    toolCalls: response.toolCalls,
    promptTokens,
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function buildProviderMessages(
  systemPrompt: string,
  summary: string | null,
  messages: Message[],
): ProviderMessage[] {
  const result: ProviderMessage[] = [];

  // System prompt
  result.push({ role: "system", content: systemPrompt });

  // Compaction summary (if checkpoint happened)
  if (summary) {
    result.push({ role: "system", content: `[Previous conversation summary]\n${summary}` });
  }

  // Message history
  for (const msg of messages) {
    const providerMsg: ProviderMessage = {
      role: msg.role as ProviderMessage["role"],
      content: msg.content,
    };

    if (msg.toolCallId) {
      providerMsg.toolCallId = msg.toolCallId;
    }

    if (msg.toolCalls) {
      providerMsg.toolCalls = msg.toolCalls.map(tc => ({
        id: tc.id,
        command: tc.command,
        args: tc.args,
      }));
    }

    result.push(providerMsg);
  }

  return result;
}

async function saveAssistantMessage(
  sessionId: string,
  response: InferenceResponse,
): Promise<void> {
  // Single assistant message — content + optional toolCalls in one record
  const hasContent = response.content !== null && response.content !== undefined;
  const hasToolCalls = response.toolCalls !== null && response.toolCalls !== undefined && response.toolCalls.length > 0;

  if (!hasContent && !hasToolCalls) return;

  const metadata: MessageMetadata = {
    source: "assistant",
    messageType: "chat",
    visibility: "user",
  };

  await messagesRepo.addMessage(
    sessionId,
    {
      role: "assistant",
      content: response.content ?? "",
      toolCalls: hasToolCalls
        ? response.toolCalls!.map(tc => ({ id: tc.id, command: tc.name, args: tc.arguments }))
        : undefined,
      timestamp: new Date().toISOString(),
    },
    metadata,
  );
}
