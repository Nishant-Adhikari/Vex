/**
 * Engine runner — agent turn entry point.
 *
 * "Agent" is the one-shot conversational session kind (post-M12 rename
 * from "chat"). The model may emit tool calls, dispatch transactions
 * subject to session permission, and respond with text. No loop — when
 * a final text reply lands the turn ends. Wake / `loop_defer` are
 * mission-mode only.
 */

import type { TurnResult } from "../../types.js";
import { hydrateEngineSession } from "../hydrate.js";
import type { TurnLoopConfig } from "../turn-loop.js";
import { runTurnLoop } from "../turn-loop.js";
import { getOpenAITools } from "@vex-agent/tools/registry.js";
import { computeBand, type ContextUsageBand } from "../context-band.js";
import { resolveProvider } from "@vex-agent/inference/registry.js";
import { appendMessage } from "@vex-agent/engine/events/index.js";
import logger from "@utils/logger.js";
import { toToolDefinitions, DEFAULT_LOOP_CONFIG } from "./shared.js";

// ── processAgentTurn ────────────────────────────────────────────

/**
 * Process a single agent turn. User sends message → engine responds.
 * For sessionKind="agent", the turn-loop iterates tool-call rounds
 * until the model emits a final text reply (capped by maxIterations).
 */
export async function processAgentTurn(
  sessionId: string,
  userInput: string,
): Promise<TurnResult> {
  logger.info("engine.agent.turn", { sessionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  // Save user message
  await appendMessage(
    sessionId,
    { role: "user", content: userInput, timestamp: new Date().toISOString() },
    { source: "user", messageType: "chat", visibility: "user" },
  );

  // Hydrate
  const hydrated = await hydrateEngineSession(sessionId);
  if (!hydrated) throw new Error(`Session ${sessionId} not found`);

  // Force agent semantics — even if session has a mission attached, this
  // entry point always processes a single agent turn (no mission loop).
  const agentContext = { ...hydrated.context, sessionKind: "agent" as const };

  const buildToolsForBand = (contextUsageBand: ContextUsageBand) => toToolDefinitions(getOpenAITools({
    permission: agentContext.sessionPermission,
    role: "parent",
    sessionKind: "agent",
    missionRunActive: false,
    contextUsageBand,
  }));
  const tools = buildToolsForBand(computeBand(hydrated.tokenCount, config.contextLimit));

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    // Agent iterates through tool-call rounds until the model emits a final
    // text reply; turn-loop.ts breaks on text for sessionKind="agent", so this
    // cap only engages when the model loops on tool-calls without ever
    // summarising.
    maxIterations: 10,
    contextLimit: config.contextLimit,
    buildToolsForBand,
  };

  const result = await runTurnLoop(
    agentContext,
    hydrated.messages,
    hydrated.summary,
    hydrated.tokenCount,
    provider,
    config,
    tools,
    loopConfig,
  );

  return {
    text: result.text,
    toolCallsMade: result.toolCallsMade,
    pendingApprovals: result.pendingApprovals,
    stopReason: result.stopReason,
    missionStatus: null,
  };
}
