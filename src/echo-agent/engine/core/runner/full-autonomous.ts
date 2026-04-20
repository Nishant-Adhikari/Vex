/**
 * Engine runner — standalone full-autonomous turn entrypoint (PR-10).
 *
 * Shape diverges from chat/mission:
 *   - `sessionKind = "full_autonomous"` and no mission attached.
 *   - `loopMode = "full"` so `loop_defer` is visible in the toolset.
 *   - `maxIterations` follows `DEFAULT_LOOP_CONFIG` (50); without a mission
 *     there are no business stops — only `loop_defer` (→ paused_wake),
 *     `user_stopped` (abort), `iteration_limit`, `timeout`.
 *
 * Resume semantics: `resumeFullAutonomousSession(sessionId)` is what PR-7's
 * wake executor invokes for `kind='full_autonomous'` rows. It re-reads
 * hydrated state, rebuilds the tool surface under the lagging context band,
 * and re-enters the turn loop with NO new user input (the wake banner is
 * already persisted by the executor).
 */

import type { TurnResult } from "../../types.js";
import { hydrateEngineSession } from "../hydrate.js";
import type { TurnLoopConfig } from "../turn-loop.js";
import { runTurnLoop } from "../turn-loop.js";
import { getOpenAITools } from "@echo-agent/tools/registry.js";
import { computeBand } from "../context-band.js";
import { resolveProvider } from "@echo-agent/inference/registry.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import { refreshBlobTtlForRecentMessages } from "../../wake/blob-refresh.js";
import logger from "@utils/logger.js";
import { toToolDefinitions, DEFAULT_LOOP_CONFIG } from "./shared.js";

export async function processFullAutonomousTurn(
  sessionId: string,
  userInput: string,
): Promise<TurnResult> {
  logger.info("engine.full_autonomous.turn", { sessionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  await messagesRepo.addMessage(
    sessionId,
    { role: "user", content: userInput, timestamp: new Date().toISOString() },
    { source: "user", messageType: "chat", visibility: "user" },
  );

  return runFullAutonomousLoop(sessionId, provider, config);
}

export async function resumeFullAutonomousSession(sessionId: string): Promise<TurnResult> {
  logger.info("engine.full_autonomous.resume", { sessionId });

  const provider = await resolveProvider();
  if (!provider) throw new Error("No inference provider available");

  const config = await provider.loadConfig();
  if (!config) throw new Error("No inference config available");

  return runFullAutonomousLoop(sessionId, provider, config);
}

// ── Shared loop entry ──────────────────────────────────────────────

async function runFullAutonomousLoop(
  sessionId: string,
  provider: Awaited<ReturnType<typeof resolveProvider>>,
  config: NonNullable<Awaited<ReturnType<NonNullable<Awaited<ReturnType<typeof resolveProvider>>>["loadConfig"]>>>,
): Promise<TurnResult> {
  if (!provider) throw new Error("No inference provider available");

  // Refresh tool_output_blob TTLs up front so overflow pointers in the
  // session's tail are still resolvable after a long wait. See the
  // mirror call in `resumeMissionRun` for rationale. Non-fatal on error.
  await refreshBlobTtlForRecentMessages(sessionId);

  const hydrated = await hydrateEngineSession(sessionId);
  if (!hydrated) throw new Error(`Session ${sessionId} not found`);

  // Defense-in-depth — caller was supposed to ensure the session is
  // full_autonomous before reaching this runner. Guard so we never silently
  // upgrade a chat session.
  if (hydrated.context.sessionKind !== "full_autonomous") {
    throw new Error(
      `processFullAutonomousTurn called on non-full_autonomous session (kind=${hydrated.context.sessionKind})`,
    );
  }

  const resumeBand = computeBand(hydrated.tokenCount, config.contextLimit);
  const tools = toToolDefinitions(getOpenAITools({
    chatMode: "full",
    role: "parent",
    sessionKind: "full_autonomous",
    missionRunActive: false,
    contextUsageBand: resumeBand,
  }));

  const loopConfig: TurnLoopConfig = {
    ...DEFAULT_LOOP_CONFIG,
    contextLimit: config.contextLimit,
  };

  const result = await runTurnLoop(
    { ...hydrated.context, sessionKind: "full_autonomous", loopMode: "full" },
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
