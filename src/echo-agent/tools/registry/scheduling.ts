/**
 * Scheduling — echo-agent only. Cron lifecycle is owned by the agent runtime,
 * not the MCP host; MCP hides these via `excludeFromMcp`.
 */

import type { ToolDef } from "../types.js";

export const SCHEDULING_TOOLS: readonly ToolDef[] = [
  {
    name: "schedule_create", kind: "internal", mutating: false,
    excludeFromMcp: true,
    description: "Create a recurring cron task.",
    parameters: { type: "object", properties: {
      name: { type: "string", description: "Task name" },
      cron: { type: "string", description: "Cron expression" },
      type: { type: "string", enum: ["tool_call", "wake_agent", "reminder", "monitor", "snapshot", "backup"], description: "Task type" },
      description: { type: "string", description: "Task description" },
      payload: { type: "object", description: "Task payload" },
    }, required: ["name", "cron", "type"] },
  },
  {
    name: "schedule_remove", kind: "internal", mutating: false,
    excludeFromMcp: true,
    description: "Remove a scheduled task.",
    parameters: { type: "object", properties: {
      id: { type: "string", description: "Task ID" },
    }, required: ["id"] },
  },
];
