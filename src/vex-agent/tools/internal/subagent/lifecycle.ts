/**
 * Subagent lifecycle management — in-memory tracking, ownership guards, execution.
 */

import * as subagentsRepo from "@vex-agent/db/repos/subagents.js";
import * as sessionLinksRepo from "@vex-agent/db/repos/session-links.js";
import type { ToolResult } from "../../types.js";
import logger from "@utils/logger.js";

// ── In-memory tracking ──────────────────────────────────────────

export interface ActiveSubagent {
  id: string;
  name: string;
  abortController: AbortController;
}

export const activeSubagents = new Map<string, ActiveSubagent>();

// ── Ownership guard ─────────────────────────────────────────────

/**
 * Validate that the parent session owns the subagent via session_links.
 * Returns subagent + child session or a ToolResult error.
 */
export async function validateOwnership(
  subagentId: string,
  parentSessionId: string,
): Promise<{ subagent: subagentsRepo.SubagentState; childSessionId: string } | ToolResult> {
  const sub = await subagentsRepo.getById(subagentId);
  if (!sub) return { success: false, output: `Subagent ${subagentId} not found` };

  const link = await sessionLinksRepo.getSubagentSession(subagentId);
  if (!link) return { success: false, output: `No session link for subagent ${subagentId}` };
  if (link.parentSessionId !== parentSessionId) {
    return { success: false, output: `Subagent ${subagentId} is not owned by this session` };
  }

  return { subagent: sub, childSessionId: link.childSessionId };
}

export function isToolResult(v: unknown): v is ToolResult {
  return typeof v === "object" && v !== null && "success" in v && "output" in v;
}

// ── Shared lifecycle helper ─────────────────────────────────────

/**
 * Fire-and-forget subagent execution.
 * Used by both subagent_spawn (initial run) and subagent_reply (resume).
 * Registers AbortController in activeSubagents, cleans up on completion.
 */
export function startSubagentExecution(id: string, name: string): void {
  const abortController = new AbortController();
  activeSubagents.set(id, { id, name, abortController });

  executeSubagentLifecycle(id, name, abortController.signal).finally(() => {
    activeSubagents.delete(id);
  });
}

async function executeSubagentLifecycle(id: string, name: string, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  try {
    const { runSubagentEngine } = await import("@vex-agent/engine/subagents/runner.js");
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

// ── Helpers ─────────────────────────────────────────────────────

export function formatSubagent(s: subagentsRepo.SubagentState): Record<string, unknown> {
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
