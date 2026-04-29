/**
 * Ingress router — the single entry point transport layers (MCP, CLI) call
 * when a user message arrives for a session.
 *
 * Responsibilities:
 *   1. Cancel any pending `loop_defer` wake for the session (user preempt).
 *   2. Re-check mission run / session state.
 *   3. Route the message to the right runtime:
 *        - `paused_wake` mission run → flip to `running` + save user msg +
 *          `resumeMissionRun` so the agent sees the preempt as the next user
 *          turn instead of a scheduled wake.
 *        - `running` / `paused_approval` mission run → persist the message
 *          as an interrupt; resume is driven by the approval flow, not here.
 *        - `full_autonomous` session without a mission run →
 *          `processFullAutonomousTurn`.
 *        - Everything else → `processChatTurn` (chat / mission-setup).
 */

import type { TurnResult } from "./types.js";
import {
  processChatTurn,
  processMissionSetupTurn,
  processFullAutonomousTurn,
  resumeMissionRun,
} from "./core/runner.js";
import * as loopWakeRepo from "@vex-agent/db/repos/loop-wake.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import logger from "@utils/logger.js";

/**
 * Route an incoming user message to the correct runtime. Always cancels any
 * pending wake first so the freshly-typed user turn is not racing against a
 * banner injection for a stale wake.
 */
export async function routeUserMessage(
  sessionId: string,
  userInput: string,
): Promise<TurnResult> {
  const cancelled = await loopWakeRepo.cancelForSession(sessionId, "user_preempt");
  if (cancelled > 0) {
    logger.info("ingress.preempt_cancelled_wake", { sessionId, cancelled });
  }

  const activeRun = await missionRunsRepo.getActiveRunBySession(sessionId);

  if (activeRun) {
    if (activeRun.status === "paused_wake") {
      return resumeMissionRunWithPreempt(sessionId, userInput, activeRun.id);
    }
    // `paused_approval` / `running` — persist the message as an interrupt
    // but do NOT fire a new turn here. Approvals resume through their own
    // flow (`approveAndResume`); a running run will pick up the message on
    // its next iteration.
    await messagesRepo.addMessage(
      sessionId,
      { role: "user", content: userInput, timestamp: new Date().toISOString() },
      { source: "user", messageType: "chat", visibility: "user" },
    );
    logger.info("ingress.user_interrupt_persisted", {
      sessionId,
      runId: activeRun.id,
      runStatus: activeRun.status,
    });
    return {
      text: null,
      toolCallsMade: 0,
      pendingApprovals: [],
      stopReason: null,
      missionStatus: null,
    };
  }

  // No active run — route by session kind.
  const session = await sessionsRepo.getSession(sessionId);
  const kind = session?.kind ?? "chat";

  if (kind === "full_autonomous") {
    return processFullAutonomousTurn(sessionId, userInput);
  }

  // Chat or mission-setup. Mission-setup is distinguished by the presence of
  // a non-terminal mission without an active run (draft/ready).
  const mission = await missionsRepo.getActiveMission(sessionId);
  if (mission && mission.status !== "running") {
    return processMissionSetupTurn(sessionId, userInput);
  }

  return processChatTurn(sessionId, userInput);
}

async function resumeMissionRunWithPreempt(
  sessionId: string,
  userInput: string,
  runId: string,
): Promise<TurnResult> {
  // Flip out of paused_wake BEFORE saving the user message so the wake
  // executor, if it races us into `claimDue`, sees the run is no longer
  // `paused_wake` in its own re-check and skips banner injection.
  await missionRunsRepo.updateStatus(runId, "running");

  await messagesRepo.addMessage(
    sessionId,
    { role: "user", content: userInput, timestamp: new Date().toISOString() },
    {
      source: "user",
      messageType: "chat",
      visibility: "user",
      payload: { preempt: "wake" },
    },
  );

  logger.info("ingress.preempt_resume", { sessionId, runId });
  // `resumeMissionRun` refreshes tool_output_blob TTLs internally (PR-13
  // S-2), so we don't double-call here. If that behaviour ever moves, the
  // ingress path still has the opportunity to refresh before entering the
  // runner — restore the call above.
  return resumeMissionRun(runId);
}
