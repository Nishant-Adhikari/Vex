/**
 * Checkpoint — compaction when approaching context limit.
 *
 * Uses chatCompletionSimple() to summarize the conversation,
 * then archives old messages via sessions.checkpointSession().
 */

import type { InferenceProvider, InferenceConfig } from "@echo-agent/inference/types.js";
import type { Message } from "@echo-agent/db/repos/messages.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";

/** Threshold: checkpoint when tokenCount exceeds 90% of context limit. */
const CHECKPOINT_THRESHOLD = 0.9;

/**
 * Whether a checkpoint is needed based on current token usage.
 */
export function shouldCheckpoint(tokenCount: number, contextLimit: number): boolean {
  if (contextLimit <= 0) return false;
  return tokenCount >= contextLimit * CHECKPOINT_THRESHOLD;
}

/**
 * Execute a checkpoint: summarize conversation and archive old messages.
 *
 * 1. Build compaction prompt from current messages
 * 2. Call provider.chatCompletionSimple() for summary
 * 3. sessions.checkpointSession() to save summary + archive messages
 */
export async function executeCheckpoint(
  sessionId: string,
  messages: Message[],
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<string> {
  const compactionPrompt = buildCompactionPrompt(messages);

  const { content: summary } = await provider.chatCompletionSimple(
    [
      { role: "system", content: compactionPrompt },
    ],
    config,
  );

  // Archive messages and save summary
  await sessionsRepo.checkpointSession(sessionId, summary);
  await sessionsRepo.archiveMessages(sessionId);

  return summary;
}

// ── Compaction prompt ───────────────────────────────────────────

function buildCompactionPrompt(messages: Message[]): string {
  const conversation = messages
    .map(m => `[${m.role}]: ${m.content.slice(0, 500)}`)
    .join("\n");

  return `You are a conversation summarizer. Summarize the following conversation into a concise summary that preserves:
- Key decisions made
- Tool calls executed and their results
- Current state of any ongoing mission or task
- Important data points (balances, prices, positions)
- Any pending actions or next steps

Be concise but complete. The summary will replace the original messages.

Conversation:
${conversation}`;
}
