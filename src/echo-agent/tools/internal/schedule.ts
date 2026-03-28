/**
 * Schedule internal tool handlers — new contract without cli_execute.
 *
 * Task types: tool_call, wake_agent, reminder, monitor, snapshot, backup.
 */

import { randomUUID } from "node:crypto";
import * as schedulesRepo from "@echo-agent/db/repos/schedules.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { str, ok, fail } from "./types.js";

const VALID_TASK_TYPES = new Set(["tool_call", "wake_agent", "reminder", "monitor", "snapshot", "backup"]);

// ── schedule_create ─────────────────────────────────────────────

export async function handleScheduleCreate(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const name = str(params, "name");
  const cronExpr = str(params, "cron");
  const taskType = str(params, "type");

  if (!name) return fail("Missing required: name");
  if (!cronExpr) return fail("Missing required: cron");
  if (!taskType) return fail("Missing required: type");

  if (!VALID_TASK_TYPES.has(taskType)) {
    return fail(`Invalid task type: "${taskType}". Must be one of: ${[...VALID_TASK_TYPES].join(", ")}`);
  }

  // Validate cron expression
  const { default: cron } = await import("node-cron");
  if (!cron.validate(cronExpr)) {
    return fail(`Invalid cron expression: "${cronExpr}"`);
  }

  // Parse payload
  let payload: Record<string, unknown>;
  if (!params.payload) {
    payload = {};
  } else if (typeof params.payload === "object") {
    payload = params.payload as Record<string, unknown>;
  } else if (typeof params.payload === "string") {
    try {
      payload = JSON.parse(params.payload) as Record<string, unknown>;
    } catch {
      // Wrap string payload with type-appropriate key
      const keyMap: Record<string, string> = {
        wake_agent: "prompt",
        reminder: "message",
        monitor: "condition",
        tool_call: "toolName",
      };
      payload = { [keyMap[taskType] ?? "prompt"]: params.payload };
    }
  } else {
    payload = {};
  }

  // Validate payload per task type
  if (taskType === "tool_call" && !payload.toolName) {
    return fail("tool_call requires payload.toolName");
  }
  if (taskType === "wake_agent" && !payload.prompt) {
    return fail("wake_agent requires payload.prompt");
  }
  if (taskType === "reminder" && !payload.message) {
    return fail("reminder requires payload.message");
  }
  if (taskType === "monitor" && !payload.condition && !payload.prompt) {
    return fail("monitor requires payload.condition or payload.prompt");
  }

  // Determine loopMode
  const loopMode = context.loopMode === "full"
    ? (str(params, "loopMode") || "full")
    : "restricted";

  const taskId = `task-${randomUUID()}`;
  await schedulesRepo.createSchedule({
    id: taskId,
    name,
    description: str(params, "description") || undefined,
    cronExpression: cronExpr,
    taskType,
    payload,
    loopMode,
  });

  return ok({ taskId, name, cron: cronExpr, type: taskType, message: `Schedule created: ${taskId}` });
}

// ── schedule_remove ─────────────────────────────────────────────

export async function handleScheduleRemove(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const taskId = str(params, "id");
  if (!taskId) return fail("Missing required: id");

  const removed = await schedulesRepo.deleteSchedule(taskId);
  if (!removed) return fail(`Schedule not found: ${taskId}`);

  return ok({ removed: true, taskId, message: `Schedule removed: ${taskId}` });
}
