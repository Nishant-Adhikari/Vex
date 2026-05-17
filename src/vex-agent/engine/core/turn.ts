/**
 * Single turn — one inference round-trip.
 *
 * Builds prompt stack, calls provider.chatCompletion(), parses
 * response, saves messages, logs usage + updates tokenCount.
 */

import type { EngineContext, TurnResult, MessageMetadata } from "../types.js";
import type { InferenceProvider, InferenceConfig, ProviderMessage, ParsedToolCall, ToolDefinition } from "@vex-agent/inference/types.js";
import type { Message } from "@vex-agent/db/repos/messages.js";
import { buildPromptStack, type PromptStackOptions } from "../prompts/index.js";
import { formatActiveKnowledgeBlock } from "../prompts/knowledge.js";
import { buildKnowledgeStateBanner } from "../prompts/knowledge-state.js";
import { buildMemoryStateBanner } from "../prompts/memory-state.js";
import { sanitizeForSystemPrompt } from "../prompts/sanitize.js";
import { repairOrphanedToolCalls } from "./transcript-integrity.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as usageRepo from "@vex-agent/db/repos/usage.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as knowledgeRepo from "@vex-agent/db/repos/knowledge.js";
import { getSessionMemoryStats } from "@vex-agent/db/repos/session-memories/index.js";
import {
  ACTIVE_KNOWLEDGE_ENTRY_LIMIT,
  KNOWN_KINDS_LIMIT,
} from "@vex-agent/knowledge/policy.js";
import {
  KNOWLEDGE_BANNER_TOP_KINDS_LIMIT,
  MEMORY_BANNER_RECENT_THEMES_LIMIT,
} from "@vex-agent/memory/policy.js";
import logger from "@utils/logger.js";

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
 * 4. Log usage + update tokenCount
 *
 * NOTE: Does NOT save the assistant message. The caller (turn-loop)
 * handles deferred save after determining the canonical batch prefix
 * (trimming tool calls that were never dispatched due to approval/signal breaks).
 * Use saveAssistantMessage() for the actual persist.
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
  // Pre-fetch Active Knowledge inputs (hot context entries + known kinds taxonomy
  // + active count for the state banner). All four queries are indexed and cheap;
  // failure here is non-fatal — we just render an empty Active Knowledge block
  // and an empty knowledge-state banner instead of crashing the turn.
  let activeKnowledgeBlock = "";
  let knowledgeStateBanner = "";
  try {
    const [activeEntries, knownKinds, activeCount] = await Promise.all([
      knowledgeRepo.listActiveForHotContext({ limit: ACTIVE_KNOWLEDGE_ENTRY_LIMIT }),
      knowledgeRepo.listKnownKinds({ limit: KNOWN_KINDS_LIMIT }),
      knowledgeRepo.countActiveHotContextEntries(),
    ]);
    activeKnowledgeBlock = formatActiveKnowledgeBlock(activeEntries, knownKinds);
    knowledgeStateBanner = buildKnowledgeStateBanner({
      activeCount,
      topKinds: knownKinds.slice(0, KNOWLEDGE_BANNER_TOP_KINDS_LIMIT),
    });
  } catch (err) {
    logger.warn("turn.active_knowledge.fetch_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Pre-fetch per-session narrative-memory stats for the memory-state banner.
  // Single CTE round-trip — `getSessionMemoryStats` returns activeCount,
  // compactCount (from sessions.checkpoint_generation), recentThemes and
  // unresolvedOutstandingCount in one query. Failure → empty banner.
  let memoryStateBanner = "";
  try {
    const memStats = await getSessionMemoryStats(
      context.sessionId,
      MEMORY_BANNER_RECENT_THEMES_LIMIT,
    );
    memoryStateBanner = buildMemoryStateBanner(memStats);
  } catch (err) {
    logger.warn("turn.memory_state.fetch_failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Build prompt — banners passed through promptOptions; the caller (turn-loop)
  // may have already supplied `contextPressureBanner` and `resumePacket`.
  const promptLayers = buildPromptStack(context, {
    ...promptOptions,
    activeKnowledgeBlock,
    knowledgeStateBanner,
    memoryStateBanner,
  });
  const systemPrompt = promptLayers.join("\n\n---\n\n");

  // Convert to provider format
  const providerMessages = buildProviderMessages(
    systemPrompt,
    summary,
    existingMessages,
  );

  // In-flight repair only; DB tape remains unchanged.
  const repair = repairOrphanedToolCalls(providerMessages);
  if (repair.insertedPlaceholders > 0) {
    logger.info("turn.transcript.repaired", {
      sessionId: context.sessionId,
      inserted: repair.insertedPlaceholders,
    });
  }

  // Inference
  const response = await provider.chatCompletion(repair.messages, tools, config);

  // Log usage + update token count
  // NOTE: assistant message is NOT saved here — turn-loop handles deferred save
  // after determining the canonical batch prefix (trimming unexecuted tool calls).
  const promptTokens = response.usage.promptTokens ?? 0;
  const completionTokens = response.usage.completionTokens ?? 0;

  // token_count = SET, not accumulate. Stores the latest prompt size (total tokens
  // sent to provider including system prompt + messages). Used by checkpoint to
  // evaluate context window pressure: shouldCheckpoint(tokenCount, contextLimit).
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

  // Compaction summary (if checkpoint happened). The summary is the agent's
  // own `compact_now.conversation_summary` argument — LLM-emitted prose that
  // reaches the next provider call as a system message. Sanitize before
  // injection so a crafted summary can't carry fence escapes or pseudo role
  // tags into the durable rolling context.
  if (summary) {
    result.push({
      role: "system",
      content: `[Previous conversation summary]\n${sanitizeForSystemPrompt(summary)}`,
    });
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

/**
 * Save an assistant message to DB.
 *
 * Exported for use by turn-loop (deferred save after canonical batch prefix
 * is determined). Accepts ParsedToolCall[] directly — converts to Message format.
 */
export async function saveAssistantMessage(
  sessionId: string,
  content: string | null,
  toolCalls: ParsedToolCall[] | null,
): Promise<void> {
  const hasContent = content !== null && content !== undefined;
  const hasToolCalls = toolCalls !== null && toolCalls !== undefined && toolCalls.length > 0;

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
      content: content ?? "",
      toolCalls: hasToolCalls
        ? toolCalls!.map(tc => ({ id: tc.id, command: tc.name, args: tc.arguments }))
        : undefined,
      timestamp: new Date().toISOString(),
    },
    metadata,
  );
}
