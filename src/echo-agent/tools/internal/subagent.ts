/**
 * Subagent internal tool handlers — lifecycle management + two-way control plane.
 *
 * Tools:
 *   Parent: subagent_spawn, subagent_status, subagent_stop, subagent_reply
 *   Child:  subagent_request_parent, subagent_report_complete
 *
 * Lifecycle helper: startSubagentExecution() used by both spawn (initial)
 * and reply (resume after wait_for_parent). Fire-and-forget background.
 *
 * Own implementation — does NOT import from src/agent/subagent.ts.
 */

import { randomUUID } from "node:crypto";
import * as subagentsRepo from "@echo-agent/db/repos/subagents.js";
import * as sessionsRepo from "@echo-agent/db/repos/sessions.js";
import * as sessionLinksRepo from "@echo-agent/db/repos/session-links.js";
import * as subagentMessagesRepo from "@echo-agent/db/repos/subagent-messages.js";
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

// ── Ownership guard ─────────────────────────────────────────────

/**
 * Validate that the parent session owns the subagent via session_links.
 * Returns subagent + child session or a ToolResult error.
 */
async function validateOwnership(
  subagentId: string,
  parentSessionId: string,
): Promise<{ subagent: subagentsRepo.SubagentState; childSessionId: string } | ToolResult> {
  const sub = await subagentsRepo.getById(subagentId);
  if (!sub) return fail(`Subagent ${subagentId} not found`);

  const link = await sessionLinksRepo.getSubagentSession(subagentId);
  if (!link) return fail(`No session link for subagent ${subagentId}`);
  if (link.parentSessionId !== parentSessionId) {
    return fail(`Subagent ${subagentId} is not owned by this session`);
  }

  return { subagent: sub, childSessionId: link.childSessionId };
}

function isToolResult(v: unknown): v is ToolResult {
  return typeof v === "object" && v !== null && "success" in v && "output" in v;
}

// ── Shared lifecycle helper ─────────────────────────────────────

/**
 * Fire-and-forget subagent execution.
 * Used by both subagent_spawn (initial run) and subagent_reply (resume).
 * Registers AbortController in activeSubagents, cleans up on completion.
 */
function startSubagentExecution(id: string, name: string): void {
  const abortController = new AbortController();
  activeSubagents.set(id, { id, name, abortController });

  executeSubagentLifecycle(id, name, abortController.signal).finally(() => {
    activeSubagents.delete(id);
  });
}

async function executeSubagentLifecycle(id: string, name: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  try {
    const { runSubagentEngine } = await import("@echo-agent/engine/subagents/runner.js");
    const result = await runSubagentEngine(id, signal);

    // Race guard: if subagent was stopped while running, don't overwrite
    const current = await subagentsRepo.getById(id);
    if (current?.status === "stopped") {
      logger.info("subagent.skip_finalize", { id, name, reason: "already stopped" });
      return;
    }

    // Don't finalize waiting_for_parent — child is paused, will resume on subagent_reply
    if (result.stopReason === "waiting_for_parent") {
      logger.info("subagent.waiting_for_parent", { id, name });
      return;
    }

    if (result.success) {
      await subagentsRepo.updateStatus(id, "completed", {
        result: result.output.slice(0, 2000),
        iterations: result.toolCallsMade,
      });
      logger.info("subagent.completed", { id, name, toolCalls: result.toolCallsMade });
    } else {
      await subagentsRepo.updateStatus(id, "error", {
        error: result.output.slice(0, 2000),
        iterations: result.toolCallsMade,
      });
      logger.warn("subagent.engine_error", { id, name, output: result.output.slice(0, 200) });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const current = await subagentsRepo.getById(id);
    if (current?.status === "stopped") return;
    await subagentsRepo.updateStatus(id, "error", { error: message });
    logger.warn("subagent.failed", { id, name, error: message });
  }
}

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

  if (activeSubagents.size >= subConfig.maxConcurrent) {
    return fail(`Max concurrent subagents (${subConfig.maxConcurrent}) reached. Wait for one to complete.`);
  }

  for (const [, sub] of activeSubagents) {
    if (sub.name === name) {
      return fail(`Subagent "${name}" is already running. Choose a different name.`);
    }
  }

  const allowTrades = bool(params, "allow_trades");
  const maxIterations = num(params, "max_iterations") ?? subConfig.maxIterations;
  const subagentId = `subagent-${randomUUID()}`;
  const childSessionId = `session-${randomUUID()}`;

  await subagentsRepo.insert({ id: subagentId, name, task, allowTrades, maxIterations });
  await sessionsRepo.createSession(childSessionId);
  await sessionsRepo.setScope(childSessionId, "subagent");
  await sessionLinksRepo.linkSessions(context.sessionId, childSessionId, "subagent", subagentId);

  logger.info("subagent.spawned", { id: subagentId, name, childSessionId, allowTrades, maxIterations });

  startSubagentExecution(subagentId, name);

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

// ── subagent_status ─────────────────────────────────────────────

export async function handleSubagentStatus(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const id = str(params, "id") || undefined;

  if (id) {
    // Hard ownership guard for specific subagent
    const check = await validateOwnership(id, context.sessionId);
    if (isToolResult(check)) return check;
    const { subagent: sub } = check;

    const formatted = formatSubagent(sub);

    // Enrich with pending request for waiting subagents
    if (sub.status === "waiting_for_parent") {
      const pending = await subagentMessagesRepo.getUnhandled(id, "to_parent", "request_parent");
      if (pending.length > 0) {
        const latest = pending[pending.length - 1];
        formatted.pendingRequest = {
          messageId: latest.id,
          question: latest.content,
          payload: latest.payloadJson,
          createdAt: latest.createdAt,
        };
      }
    }

    // Include latest report for completed subagents
    if (sub.status === "completed") {
      const reports = await subagentMessagesRepo.getMessagesByType(id, "report_complete");
      if (reports.length > 0) {
        const latest = reports[0]; // DESC order
        formatted.report = {
          summary: latest.content,
          findings: latest.payloadJson,
          createdAt: latest.createdAt,
        };
      }
    }

    return ok(formatted);
  }

  // List all — no hard ownership guard, but soft enrichment only for owned
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
  context: InternalToolContext,
): Promise<ToolResult> {
  const id = str(params, "id");
  if (!id) return fail("Missing required: id");

  // Ownership guard
  const check = await validateOwnership(id, context.sessionId);
  if (isToolResult(check)) return check;

  const active = activeSubagents.get(id);
  if (active) {
    active.abortController.abort();
    activeSubagents.delete(id);
  }

  await subagentsRepo.updateStatus(id, "stopped");
  logger.info("subagent.stopped", { id });

  return ok({ id, stopped: true, message: `Subagent ${id} stopped` });
}

// ── subagent_reply (parent → child) ─────────────────────────────

export async function handleSubagentReply(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const subagentId = str(params, "id");
  const reply = str(params, "reply");
  const messageId = num(params, "message_id");
  if (!subagentId || !reply) return fail("Missing required: id, reply");

  // Ownership guard
  const check = await validateOwnership(subagentId, context.sessionId);
  if (isToolResult(check)) return check;
  const { subagent: sub } = check;

  if (sub.status !== "waiting_for_parent") {
    return fail(`Subagent ${subagentId} is not waiting for parent (status: ${sub.status})`);
  }

  // 1. Send reply to child
  await subagentMessagesRepo.sendStructuredMessage(
    subagentId, "to_child", reply, "reply", { reply }, messageId ?? undefined,
  );

  // 2. Mark original request as handled
  if (messageId) {
    await subagentMessagesRepo.markHandled(messageId);
  }

  // 3. Atomowe przejście: waiting_for_parent → running (CAS guard)
  await subagentsRepo.updateStatus(subagentId, "running");

  // 4. Resume via shared lifecycle helper — fire-and-forget
  startSubagentExecution(subagentId, sub.name);

  logger.info("subagent.resumed", { id: subagentId, name: sub.name });

  return ok({
    subagentId,
    replied: true,
    message: `Reply sent to subagent "${sub.name}". Subagent resumed.`,
  });
}

// ── subagent_request_parent (child → parent) ────────────────────

export async function handleSubagentRequestParent(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const question = str(params, "question");
  if (!question) return fail("Missing required: question");

  // Find subagent by session (child calls this, context.sessionId is child session)
  const link = await sessionLinksRepo.getParentSession(context.sessionId);
  if (!link?.subagentId) return fail("Not a subagent session — cannot request parent");
  const subagentId = link.subagentId;

  const messageId = await subagentMessagesRepo.sendStructuredMessage(
    subagentId, "to_parent", question, "request_parent",
    { question, context: str(params, "context") || undefined },
  );

  await subagentsRepo.updateStatus(subagentId, "waiting_for_parent");

  logger.info("subagent.request_parent", { id: subagentId, messageId });

  return {
    success: true,
    output: `Request sent to parent (message #${messageId}). Waiting for reply...`,
    data: { messageId, subagentId },
    engineSignal: {
      type: "wait_for_parent",
      reason: "waiting_for_parent",
      summary: question,
      messageId,
    },
  };
}

// ── subagent_report_complete (child → parent) ───────────────────

export async function handleSubagentReportComplete(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const summary = str(params, "summary");
  if (!summary) return fail("Missing required: summary");

  const link = await sessionLinksRepo.getParentSession(context.sessionId);
  if (!link?.subagentId) return fail("Not a subagent session");
  const subagentId = link.subagentId;

  const findings = typeof params.findings === "object" && params.findings !== null
    ? params.findings as Record<string, unknown> : undefined;

  // 1. Save structured report FIRST
  await subagentMessagesRepo.sendStructuredMessage(
    subagentId, "to_parent", summary, "report_complete",
    { summary, findings, success: params.success !== false },
  );

  logger.info("subagent.report_complete", { id: subagentId, summary: summary.slice(0, 100) });

  // 2. THEN return engineSignal to end child run
  return {
    success: true,
    output: `Report submitted to parent: ${summary}`,
    data: { subagentId, summary, findings },
    engineSignal: {
      type: "complete_subagent",
      reason: "goal_reached",
      summary,
      evidence: findings,
    },
  };
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
