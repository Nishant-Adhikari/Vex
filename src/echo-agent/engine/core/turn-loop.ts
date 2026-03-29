/**
 * Turn loop — main engine loop. Iterates inference turns.
 *
 * In mission run, text from model does NOT end the loop.
 * Ends only on: stop condition, approval pause, or iteration limit.
 *
 * Semantics per iteration:
 * 1. executeTurn() → model returns text and/or toolCalls
 * 2. If toolCalls → dispatch:
 *    - dispatch returns pendingApproval → pause run → break
 *    - dispatch OK → save results → next turn
 * 3. If text + stop condition → complete run → break
 * 4. If text + checkpoint needed → checkpoint → continue
 * 5. If text + no stop + mission → save text + internal continue → next turn
 * 6. If text + no stop + chat → break (chat ends on text)
 */

import type { EngineContext, TurnResult, StopReason } from "../types.js";
import type { InferenceProvider, InferenceConfig, ToolDefinition } from "@echo-agent/inference/types.js";
import type { Message } from "@echo-agent/db/repos/messages.js";
import type { PromptStackOptions } from "../prompts/index.js";
import { executeTurn, type SingleTurnResult } from "./turn.js";
import { evaluateRuntimeStopConditions, type StopConditionContext } from "./stop-conditions.js";
import { shouldCheckpoint, executeCheckpoint } from "./checkpoint.js";
import { dispatchTool } from "@echo-agent/tools/dispatcher.js";
import type { InternalToolContext } from "@echo-agent/tools/internal/types.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as missionRunsRepo from "@echo-agent/db/repos/mission-runs.js";
import * as approvalsRepo from "@echo-agent/db/repos/approvals.js";

export interface TurnLoopConfig {
  maxIterations: number;
  timeoutMs: number;
  contextLimit: number;
}

export interface TurnLoopResult {
  text: string | null;
  toolCallsMade: number;
  pendingApprovals: string[];
  stopReason: StopReason | null;
}

/**
 * Run the turn loop.
 *
 * Iterates inference turns until a stop condition or chat response.
 */
export async function runTurnLoop(
  context: EngineContext,
  messages: Message[],
  summary: string | null,
  tokenCount: number,
  provider: InferenceProvider,
  config: InferenceConfig,
  tools: ToolDefinition[],
  loopConfig: TurnLoopConfig,
  promptOptions: PromptStackOptions = {},
  abortSignal?: AbortSignal,
): Promise<TurnLoopResult> {
  let lastText: string | null = null;
  let totalToolCalls = 0;
  const pendingApprovals: string[] = [];
  let stopReason: StopReason | null = null;
  const startTime = Date.now();
  let currentTokenCount = tokenCount;
  let currentSummary = summary;

  // Mutable copy of messages for turn history
  const liveMessages = [...messages];

  for (let iteration = 0; iteration < loopConfig.maxIterations; iteration++) {
    // Check abort signal
    if (abortSignal?.aborted) {
      stopReason = "user_stopped";
      break;
    }

    // Check runtime stop conditions
    const runtimeStop = evaluateRuntimeStopConditions({
      iterationCount: iteration,
      maxIterations: loopConfig.maxIterations,
      elapsedMs: Date.now() - startTime,
      timeoutMs: loopConfig.timeoutMs,
    });

    if (runtimeStop) {
      stopReason = runtimeStop;
      break;
    }

    // Increment iteration counter for mission runs
    if (context.missionRunId) {
      await missionRunsRepo.incrementIterations(context.missionRunId);
    }

    // Execute turn
    const turnResult = await executeTurn(
      context, liveMessages, currentSummary, provider, config, tools, promptOptions,
    );

    // Read cumulative token count from DB (updated by turn.ts → updateTokenCount)
    const freshSession = await sessionsRepo.getSession(context.sessionId);
    currentTokenCount = freshSession?.tokenCount ?? currentTokenCount;

    // ── Handle tool calls ─────────────────────────────────────
    if (turnResult.toolCalls && turnResult.toolCalls.length > 0) {
      for (const toolCall of turnResult.toolCalls) {
        totalToolCalls++;

        const toolContext: InternalToolContext = {
          sessionId: context.sessionId,
          loadedDocuments: context.loadedDocuments,
          loopMode: context.loopMode,
          approved: false,
        };

        const result = await dispatchTool(
          { name: toolCall.name, args: toolCall.arguments, toolCallId: toolCall.id },
          toolContext,
        );

        // Save tool result message
        await messagesRepo.addMessage(
          context.sessionId,
          {
            role: "tool",
            content: result.output,
            toolCallId: toolCall.id,
            timestamp: new Date().toISOString(),
          },
          { source: "tool", messageType: "tool_result", visibility: "internal" },
        );

        // Add to live messages for next turn
        liveMessages.push({
          role: "tool",
          content: result.output,
          toolCallId: toolCall.id,
          timestamp: new Date().toISOString(),
        });

        // Check for engine signal (e.g. mission_stop tool)
        if (result.engineSignal?.type === "stop_mission") {
          stopReason = result.engineSignal.reason as StopReason;
          return { text: result.output, toolCallsMade: totalToolCalls, pendingApprovals, stopReason };
        }

        // Check for pending approval — enqueue to approval_queue
        if (result.pendingApproval) {
          const approvalId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          await approvalsRepo.enqueue(
            approvalId,
            { command: toolCall.name, args: toolCall.arguments },
            result.output,
            context.sessionId,
            toolCall.id,
            context.loopMode,
          );
          pendingApprovals.push(approvalId);
          stopReason = "approval_required";

          if (context.missionRunId) {
            await missionRunsRepo.updateStatus(context.missionRunId, "paused_approval", "approval_required");
          }

          return { text: lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason };
        }
      }

      // Tool calls dispatched — continue to next turn
      continue;
    }

    // ── Handle text response ──────────────────────────────────
    if (turnResult.content) {
      lastText = turnResult.content;

      // Add assistant message to live messages
      liveMessages.push({
        role: "assistant",
        content: turnResult.content,
        timestamp: new Date().toISOString(),
      });

      // Check checkpoint
      if (shouldCheckpoint(currentTokenCount, loopConfig.contextLimit)) {
        const newSummary = await executeCheckpoint(
          context.sessionId, liveMessages, provider, config,
        );

        // Update summary for subsequent turns in this loop
        currentSummary = newSummary;

        if (context.missionRunId) {
          await missionRunsRepo.setLastCheckpoint(context.missionRunId);
        }

        // Reload messages after checkpoint (archived old ones)
        liveMessages.length = 0;
        const freshMessages = await messagesRepo.getLiveMessages(context.sessionId);
        liveMessages.push(...freshMessages);
        continue;
      }

      // Active mission RUN: text does NOT end the loop — add continue message.
      // Mission SETUP (sessionKind=mission but no missionRunId) ends on text like chat.
      if (context.missionRunId) {
        await messagesRepo.addEngineMessage(
          context.sessionId,
          "[Engine: continue — no stop condition met. Proceed with next action.]",
          { source: "engine", messageType: "continue", visibility: "internal" },
        );

        liveMessages.push({
          role: "system",
          content: "[Engine: continue — no stop condition met. Proceed with next action.]",
          timestamp: new Date().toISOString(),
        });

        continue;
      }

      // Chat and mission setup: text ends the loop
      break;
    }
  }

  // If loop exhausted without explicit stop during active mission run
  if (!stopReason && context.missionRunId) {
    stopReason = "iteration_limit";
  }

  return { text: lastText, toolCallsMade: totalToolCalls, pendingApprovals, stopReason };
}
