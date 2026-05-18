/**
 * Session hydration — reconstruct engine state from DB.
 *
 * Loads session, messages, mission (if any), active run, summary.
 * loadedDocuments is populated by the caller (documents are keyed by
 * space, not session — the caller knows which docs to load).
 */

import type { EngineContext, Permission, SessionKind } from "../types.js";
import * as sessionsRepo from "@vex-agent/db/repos/sessions.js";
import * as messagesRepo from "@vex-agent/db/repos/messages.js";
import * as missionsRepo from "@vex-agent/db/repos/missions.js";
import * as missionRunsRepo from "@vex-agent/db/repos/mission-runs.js";
import * as sessionLinksRepo from "@vex-agent/db/repos/session-links.js";

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
 *
 * `sessionKind` and `sessionPermission` are immutable per session.
 * `sessionKind` defaults to `session.mode` from DB; if an active mission
 * is attached we surface `"mission"` regardless. `sessionPermission`
 * mirrors `session.permission` and is the single source for approval
 * gates throughout the turn — no per-call DB queries downstream.
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
  let activeRun: missionRunsRepo.MissionRun | null = null;
  let missionRunId: string | null = null;

  if (mission) {
    activeRun = await missionRunsRepo.getActiveRun(mission.id);
    if (activeRun) {
      missionRunId = activeRun.id;
    }
  }

  // Mode discrimination: a session with an attached active mission acts as
  // "mission" regardless of the row's `mode` column. Sessions without a
  // mission fall through to whatever `mode` the row was created with — only
  // `"agent"` is observed today since mission setup creates the mission row
  // synchronously (see Commit C mission creation pipeline).
  const sessionKind: SessionKind = mission ? "mission" : session.mode;
  const sessionPermission: Permission = session.permission;

  return {
    context: {
      sessionId,
      sessionKind,
      sessionPermission,
      missionId: mission?.id ?? null,
      missionRunId,
      sessionStartedAt: session.startedAt,
      missionRunStartedAt: activeRun?.startedAt ?? null,
      missionDeadline: extractMissionDeadline(mission?.constraintsJson ?? null),
      isSubagent,
      loadedDocuments: new Map(), // Populated by caller
    },
    messages,
    summary: session.summary ?? null,
    tokenCount: session.tokenCount,
  };
}

function extractMissionDeadline(constraints: Record<string, unknown> | null): string | null {
  const raw = constraints?.deadline;
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
}
