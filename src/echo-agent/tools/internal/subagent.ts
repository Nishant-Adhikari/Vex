/**
 * Subagent internal tool handlers — fire-and-forget with ENV config.
 *
 * Phase 1: spawn, status, stop. Session + session_links created on spawn.
 * Inference engine integration is phase 2 — spawn finalizes immediately
 * with honest "pending" status rather than leaving zombie "running" records.
 *
 * Own implementation — does NOT import from src/agent/subagent.ts.
 */

import { randomUUID } from "node:crypto";
import * as subagentsRepo from "@echo-agent/db/repos/subagents.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as sessionLinksRepo from "@echo-agent/db/repos/session-links.js";
import { loadEnvConfig, loadSubagentConfig } from "@echo-agent/inference/config.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, num, bool, ok, fail } from "./types.js";
import logger from "@utils/logger.js";

// ── In-memory tracking ──────────────────────────────────────────

interface ActiveSubagent {
  id: string;
  name: string;
  abortController: AbortController;
}

const activeSubagents = new Map<string, ActiveSubagent>();

// ── subagent_spawn ──────────────────────────────────────────────

export async function handleSubagentSpawn(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const name = str(params, "name");
  const task = str(params, "task");
  if (!name || !task) return fail("Missing required: name, task");

  const envConfig = loadEnvConfig();
  const subConfig = loadSubagentConfig(envConfig);

  // Check concurrency limit
  if (activeSubagents.size >= subConfig.maxConcurrent) {
    return fail(`Max concurrent subagents (${subConfig.maxConcurrent}) reached. Wait for one to complete.`);
  }

  // Check name uniqueness among active
  for (const [, sub] of activeSubagents) {
    if (sub.name === name) {
      return fail(`Subagent "${name}" is already running. Choose a different name.`);
    }
  }

  const allowTrades = bool(params, "allow_trades");
  const maxIterations = num(params, "max_iterations") ?? subConfig.maxIterations;
  const subagentId = `subagent-${randomUUID()}`;
  const childSessionId = `session-${randomUUID()}`;

  // Persist subagent record
  await subagentsRepo.insert({
    id: subagentId,
    name,
    task,
    allowTrades,
    maxIterations,
  });

  // Create child session + canonical session_links relationship
  await sessionsRepo.createSession(childSessionId);
  await sessionsRepo.setScope(childSessionId, "subagent");
  await sessionLinksRepo.linkSessions(context.sessionId, childSessionId, "subagent", subagentId);

  logger.info("subagent.spawned", { id: subagentId, name, childSessionId, allowTrades, maxIterations });

  // Track in-memory
  const abortController = new AbortController();
  activeSubagents.set(subagentId, { id: subagentId, name, abortController });

  // Background execution — finalizes subagent lifecycle
  runSubagent(subagentId, name, abortController.signal).finally(() => {
    activeSubagents.delete(subagentId);
  });

  return ok({
    id: subagentId,
    name,
    sessionId: childSessionId,
    task: task.slice(0, 200),
    allowTrades,
    maxIterations,
    message: `Subagent "${name}" spawned (ID: ${subagentId}). Use subagent_status to check progress.`,
  });
}

// ── Background subagent execution ───────────────────────────────

async function runSubagent(id: string, name: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  // Phase 2: echo-agent engine inference loop integration
  // Phase 1: honest finalize — creates session/links but doesn't run inference yet.
  // Finalize immediately so subagent doesn't stay zombie "running".
  await subagentsRepo.updateStatus(id, "completed", {
    result: "Subagent session created. Inference engine integration pending (phase 2).",
    iterations: 0,
  });
  logger.info("subagent.completed", { id, name, phase: "placeholder" });
}

// ── subagent_status ─────────────────────────────────────────────

export async function handleSubagentStatus(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const id = str(params, "id") || undefined;

  if (id) {
    const sub = await subagentsRepo.getById(id);
    if (!sub) return ok({ message: `No subagent found with ID ${id}` });
    return ok(formatSubagent(sub));
  }

  // All active + recent
  const active = await subagentsRepo.getActive();
  const recent = await subagentsRepo.getRecent(10);
  const seen = new Set(active.map(s => s.id));
  const all = [...active, ...recent.filter(s => !seen.has(s.id))];

  if (all.length === 0) {
    return ok({ message: "No active or recent subagents", subagents: [] });
  }

  return ok({ count: all.length, subagents: all.map(formatSubagent) });
}

// ── subagent_stop ───────────────────────────────────────────────

export async function handleSubagentStop(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const id = str(params, "id");
  if (!id) return fail("Missing required: id");

  const active = activeSubagents.get(id);
  if (active) {
    active.abortController.abort();
    activeSubagents.delete(id);
  }

  await subagentsRepo.updateStatus(id, "stopped");
  logger.info("subagent.stopped", { id });

  return ok({ id, stopped: true, message: `Subagent ${id} stopped` });
}

// ── Helpers ─────────────────────────────────────────────────────

function formatSubagent(s: subagentsRepo.SubagentState): Record<string, unknown> {
  const durationMs = s.endedAt
    ? new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()
    : Date.now() - new Date(s.startedAt).getTime();

  return {
    id: s.id,
    name: s.name,
    status: s.status,
    allowTrades: s.allowTrades,
    iterations: s.iterations,
    maxIterations: s.maxIterations,
    durationSeconds: Math.round(durationMs / 1000),
    ...(s.result ? { result: s.result.slice(0, 500) } : {}),
    ...(s.error ? { error: s.error } : {}),
  };
}

/** Get active count — used by runtime for limit checks. */
export function getActiveCount(): number {
  return activeSubagents.size;
}
