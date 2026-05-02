import type {
  InferenceConfig,
  InferenceProvider,
  ProviderMessage,
  ToolDefinition,
} from "@vex-agent/inference/types.js";
import type { MessageWithId } from "@vex-agent/db/repos/messages.js";
import type { CheckpointHandoffPayload } from "@vex-agent/db/repos/checkpoint-handoffs.js";
import * as episodesRepo from "@vex-agent/db/repos/session-episodes.js";
import * as checkpointHandoffsRepo from "@vex-agent/db/repos/checkpoint-handoffs.js";
import { getAllTools } from "@vex-agent/tools/registry.js";
import { toOpenAITools } from "@vex-agent/tools/types.js";
import { handleCheckpointHandoffPrepare } from "@vex-agent/tools/internal/checkpoint-handoff.js";
import logger from "@utils/logger.js";
import {
  getForcedPassCooldownUntil,
  markForcedPassCooldown,
} from "./state.js";

/**
 * Cap on the number of recent live messages shown to the Phase 0 pass.
 * Keeps the inline `chatCompletion` call cheap even on pressure-loaded
 * sessions.
 */
const FORCED_PASS_MESSAGE_WINDOW = 12;

/** Cap per message shown to Phase 0 - same idea as `PER_MESSAGE_CHAR_CAP` in merge.ts. */
const FORCED_PASS_PER_MESSAGE_CAP = 500;

/**
 * Phase 0 orchestration. On miss we fall back to a deterministic DB-based
 * handoff so `effectiveRecallSeed` gets a non-empty recall query.
 */
export async function maybeRunForcedHandoffPass(
  sessionId: string,
  targetGeneration: number,
  messages: readonly MessageWithId[],
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<void> {
  const existing = await checkpointHandoffsRepo.getActive(sessionId, targetGeneration);
  if (existing) return;

  const cooldownUntil = getForcedPassCooldownUntil(sessionId);
  if (cooldownUntil !== undefined && Date.now() < cooldownUntil) {
    logger.info("checkpoint.forced_pass.cooldown_active", {
      sessionId,
      targetGeneration,
      resumesAtMs: cooldownUntil - Date.now(),
    });
    return;
  }

  const modelWroteHandoff = await runForcedHandoffPass(
    sessionId,
    targetGeneration,
    messages,
    provider,
    config,
  );

  let fallbackWroteHandoff = false;
  if (!modelWroteHandoff) {
    fallbackWroteHandoff = await writeDeterministicFallbackHandoff(sessionId, targetGeneration);
  }

  if (modelWroteHandoff || fallbackWroteHandoff) {
    markForcedPassCooldown(sessionId);
  }
}

/**
 * Side-effect-light forced pass. Calls `provider.chatCompletion` directly
 * with only `checkpoint_handoff_prepare`; the handler itself is the only DB
 * side effect.
 */
async function runForcedHandoffPass(
  sessionId: string,
  targetGeneration: number,
  messages: readonly MessageWithId[],
  provider: InferenceProvider,
  config: InferenceConfig,
): Promise<boolean> {
  const allTools = getAllTools();
  const handoffTool = allTools.find((tool) => tool.name === "checkpoint_handoff_prepare");
  if (!handoffTool) {
    logger.error("checkpoint.forced_pass.tool_missing", { sessionId });
    return false;
  }

  const tools: ToolDefinition[] = toOpenAITools([handoffTool]).map((openAITool) => ({
    type: "function" as const,
    function: openAITool.function,
  }));

  const providerMessages = buildForcedPassMessages(messages);

  let response;
  try {
    response = await provider.chatCompletion(providerMessages, tools, config);
  } catch (err) {
    logger.warn("checkpoint.forced_pass.completion_failed", {
      sessionId,
      targetGeneration,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }

  const toolCalls = response.toolCalls ?? [];
  if (toolCalls.length === 0) {
    logger.info("checkpoint.forced_pass.no_tool_call", { sessionId, targetGeneration });
    return false;
  }

  const call = toolCalls[0]!;
  if (call.name !== "checkpoint_handoff_prepare") {
    logger.warn("checkpoint.forced_pass.unexpected_tool", {
      sessionId,
      toolName: call.name,
    });
    return false;
  }

  try {
    const result = await handleCheckpointHandoffPrepare(call.arguments, {
      sessionId,
      loadedDocuments: new Map(),
      loopMode: "off",
      approved: true,
      role: "parent",
      missionRunId: null,
      missionId: null,
      sessionKind: "mission",
      contextUsageBand: "critical",
    });
    if (!result.success) {
      logger.warn("checkpoint.forced_pass.handler_rejected", {
        sessionId,
        reason: result.output,
      });
      return false;
    }
    logger.info("checkpoint.forced_pass.handoff_written", {
      sessionId,
      targetGeneration,
    });
    return true;
  } catch (err) {
    logger.warn("checkpoint.forced_pass.handler_threw", {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function buildForcedPassMessages(
  messages: readonly MessageWithId[],
): ProviderMessage[] {
  const tail = messages.slice(-FORCED_PASS_MESSAGE_WINDOW);
  const excerpt = tail
    .map((message) => `[${message.role}]: ${message.content.slice(0, FORCED_PASS_PER_MESSAGE_CAP)}`)
    .join("\n");
  const system =
    "Context is critical (>= 90%). A checkpoint will compact the prompt in a moment. " +
    "Call `checkpoint_handoff_prepare` ONCE to record what the post-compact turn needs: " +
    "`preserve_md` (what must survive), `preferred_recall_query` (recall seed), " +
    "`important_entities` (wallets, symbols, ids), `open_loops` (unresolved follow-ups). " +
    "Pass arrays as JSON strings, keep every string inside the declared bounds, and " +
    "do NOT emit any other tool call or assistant text.";
  return [
    { role: "system", content: system },
    { role: "user", content: `Recent conversation excerpt (last ${tail.length} messages):\n${excerpt}` },
  ];
}

async function writeDeterministicFallbackHandoff(
  sessionId: string,
  targetGeneration: number,
): Promise<boolean> {
  try {
    const recent = await episodesRepo.listRecentBySession(sessionId, 5);
    const payload = buildDeterministicFallbackPayload(recent);
    await checkpointHandoffsRepo.writeHandoff(sessionId, targetGeneration, payload);
    logger.info("checkpoint.forced_pass.fallback_written", {
      sessionId,
      targetGeneration,
      entityCount: payload.importantEntities.length,
      openLoopCount: payload.openLoops.length,
    });
    return true;
  } catch (err) {
    logger.error("checkpoint.forced_pass.fallback_failed", {
      sessionId,
      targetGeneration,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

function buildDeterministicFallbackPayload(
  recent: readonly episodesRepo.SessionEpisode[],
): CheckpointHandoffPayload {
  if (recent.length === 0) {
    return {
      preserveMd: "",
      preferredRecallQuery: "Resume session after compaction",
      importantEntities: [],
      openLoops: [],
    };
  }

  const titles = recent
    .slice(0, 3)
    .map((episode) => episode.title.trim())
    .filter((title) => title.length > 0);

  const preferredRecallQuery = titles.length > 0
    ? titles.join(" / ")
    : "Resume session after compaction";

  const entities = new Set<string>();
  for (const episode of recent) {
    for (const entity of episode.entities) {
      if (typeof entity !== "string") continue;
      const trimmed = entity.trim().slice(0, 100);
      if (trimmed.length === 0) continue;
      entities.add(trimmed);
      if (entities.size >= 20) break;
    }
    if (entities.size >= 20) break;
  }

  const openLoops: string[] = [];
  for (const episode of recent) {
    for (const [key, value] of Object.entries(episode.openLoops)) {
      const detail = typeof value === "string" ? value : JSON.stringify(value);
      const combined = `${key}: ${detail}`.slice(0, 200);
      openLoops.push(combined);
      if (openLoops.length >= 20) break;
    }
    if (openLoops.length >= 20) break;
  }

  return {
    preserveMd: "",
    preferredRecallQuery: preferredRecallQuery.slice(0, 500),
    importantEntities: [...entities],
    openLoops,
  };
}
