/**
 * Session hydration — reconstruct engine state from DB.
 *
 * Loads session, messages, mission (if any), active run, summary.
 * loadedDocuments is populated by the caller (documents are keyed by
 * space, not session — the caller knows which docs to load).
 */

import type { EngineContext, SessionKind, LoopMode } from "../types.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as messagesRepo from "@echo-agent/db/repos/messages.js";
import * as missionsRepo from "@echo-agent/db/repos/missions.js";
import * as missionRunsRepo from "@echo-agent/db/repos/mission-runs.js";
import * as sessionLinksRepo from "@echo-agent/db/repos/session-links.js";

export interface HydratedSession {
  context: EngineContext;
  messages: messagesRepo.Message[];
  summary: string | null;
  /** Session's token count — used for checkpoint evaluation. */
  tokenCount: number;
}

/**
 * Hydrate an engine session from DB state.
 * Returns null if session doesn't exist.
 *
 * `loadedDocuments` is left empty — the caller populates it
 * (documents are keyed by space/folder, not session).
 */
export async function hydrateEngineSession(sessionId: string): Promise<HydratedSession | null> {
  const session = await sessionsRepo.getSession(sessionId);
  if (!session) return null;

  // Load messages
  const messages = await messagesRepo.getLiveMessages(sessionId);

  // Determine if this is a subagent
  const parentLink = await sessionLinksRepo.getParentSession(sessionId);
  const isSubagent = parentLink !== null;

  // Load active mission (excludes completed/failed/cancelled)
  const mission = await missionsRepo.getActiveMission(sessionId);
  let missionRunId: string | null = null;
  let loopMode: LoopMode = "off";

  if (mission) {
    const activeRun = await missionRunsRepo.getActiveRun(mission.id);
    if (activeRun) {
      missionRunId = activeRun.id;
      loopMode = activeRun.loopMode as LoopMode;
    }
  }

  const sessionKind: SessionKind = mission ? "mission" : "chat";

  return {
    context: {
      sessionId,
      sessionKind,
      loopMode,
      missionId: mission?.id ?? null,
      missionRunId,
      isSubagent,
      loadedDocuments: new Map(), // Populated by caller
      memoryScopeKey: session.memoryScopeKey ?? sessionId,
    },
    messages,
    summary: session.summary ?? null,
    tokenCount: session.tokenCount,
  };
}
