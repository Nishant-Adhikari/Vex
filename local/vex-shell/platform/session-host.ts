/**
 * Session-host — registers shell sessions in the `sessions` table BEFORE the
 * first ingress call. `routeUserMessage()` does not auto-create sessions, and
 * `messages.session_id` / `approval_queue.session_id` carry FK constraints,
 * so skipping this would crash the first turn with a FK violation.
 *
 * Pattern mirrors `src/mcp/sessions.ts` but uses `local_shell` scope.
 *
 * Post-M12: vex-shell creates a single per-launch session — always
 * `mode='agent'` initially. Mission setup happens inside the agent session
 * via prompts; the engine promotes sessionKind to "mission" once a missions
 * row exists.
 */

import { randomBytes } from "node:crypto";
import * as sessionsRepo from "../../../src/vex-agent/db/repos/sessions.js";
import * as missionsRepo from "../../../src/vex-agent/db/repos/missions.js";
import * as missionRunsRepo from "../../../src/vex-agent/db/repos/mission-runs.js";
import * as approvalsRepo from "../../../src/vex-agent/db/repos/approvals.js";
import * as usageRepo from "../../../src/vex-agent/db/repos/usage.js";
import { computeBand } from "../../../src/vex-agent/engine/core/context-band.js";
import { loadEnvConfig } from "../../../src/vex-agent/inference/config.js";
import type {
  Session,
  SessionMode,
  SessionPermission,
} from "../../../src/vex-agent/db/repos/sessions.js";
import type { ApprovalItem } from "../../../src/vex-agent/db/repos/approvals.js";
import type { ContextWindowSummary, SessionSummary, TokenUsageSummary } from "./render.js";

const SESSION_SCOPE = "local_shell";
const ID_BYTES = 8;
const FALLBACK_CONTEXT_LIMIT = 128_000;

export interface CreateShellSessionOptions {
  mode?: SessionMode;
  permission?: SessionPermission;
  initialGoal?: string | null;
}

export async function createShellSession(
  options: CreateShellSessionOptions = {},
): Promise<string> {
  const mode = options.mode ?? "agent";
  const id = `vex-shell-${mode}-${nanoid()}`;
  await sessionsRepo.createSession(id, {
    mode,
    permission: options.permission ?? "restricted",
    initialGoal: options.initialGoal ?? null,
  });
  await sessionsRepo.setScope(id, SESSION_SCOPE);
  return id;
}

export async function endShellSession(id: string): Promise<void> {
  await sessionsRepo.endSession(id);
}

export async function getSession(id: string): Promise<Session | null> {
  return sessionsRepo.getSession(id);
}

export async function listShellSessions(limit = 10): Promise<Session[]> {
  return sessionsRepo.listSessions(SESSION_SCOPE, limit);
}

/** Pending approvals for a single session — filtered client-side because the
 *  repo only exposes `getPending()` for the whole deployment. */
export async function getPendingApprovalsForSession(sessionId: string): Promise<ApprovalItem[]> {
  const all = await approvalsRepo.getPending();
  return all.filter((a) => a.sessionId === sessionId);
}

/** Mission overlay computed from `missions` + `mission_runs`. Returns the
 *  status string the operator cares about (`draft`, `ready`, `running`,
 *  `paused_approval`, `paused_wake`, `completed`, ...) or `null` for "no mission". */
export async function getMissionStatus(sessionId: string): Promise<string | null> {
  const activeRun = await missionRunsRepo.getActiveRunBySession(sessionId);
  if (activeRun) return activeRun.status;
  const mission = await missionsRepo.getActiveMission(sessionId);
  if (mission) return mission.status;
  const latestMission = await missionsRepo.getMissionBySession(sessionId);
  return latestMission?.status ?? null;
}

export async function getMissionCommand(sessionId: string, status: string | null): Promise<"start" | "continue" | null> {
  if (status !== "ready") return null;
  const latestRun = await missionRunsRepo.getRunBySession(sessionId);
  return latestRun ? "continue" : "start";
}

export async function summarizeSession(sessionId: string): Promise<SessionSummary | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const [missionStatus, pending, usageStats] = await Promise.all([
    getMissionStatus(sessionId),
    getPendingApprovalsForSession(sessionId),
    usageRepo.getStats(sessionId),
  ]);
  const missionCommand = await getMissionCommand(sessionId, missionStatus);
  const contextLimit = resolveContextLimit();
  return {
    id: session.id,
    kind: session.mode,
    missionStatus,
    missionCommand,
    pendingApprovals: pending.length,
    usage: toTokenUsageSummary(usageStats),
    context: toContextWindowSummary(session.tokenCount, contextLimit),
  };
}

function resolveContextLimit(): number {
  try {
    return loadEnvConfig().contextLimit;
  } catch {
    const parsed = Number(process.env.AGENT_CONTEXT_LIMIT?.trim());
    return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_CONTEXT_LIMIT;
  }
}

function toTokenUsageSummary(stats: usageRepo.UsageStats): TokenUsageSummary {
  return {
    sessionTokens: stats.sessionTokens,
    sessionCost: stats.sessionCost,
    requestCount: stats.sessionRequestCount,
    lastRequestAt: stats.sessionLastRequestAt,
  };
}

function toContextWindowSummary(tokenCount: number, contextLimit: number): ContextWindowSummary {
  const safePromptTokens = Number.isFinite(tokenCount) && tokenCount > 0 ? Math.round(tokenCount) : 0;
  const safeLimit = Number.isFinite(contextLimit) && contextLimit > 0
    ? Math.round(contextLimit)
    : FALLBACK_CONTEXT_LIMIT;
  return {
    promptTokens: safePromptTokens,
    limit: safeLimit,
    percent: safeLimit > 0 ? (safePromptTokens / safeLimit) * 100 : 0,
    band: computeBand(safePromptTokens, safeLimit),
  };
}

function nanoid(): string {
  return randomBytes(ID_BYTES)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
