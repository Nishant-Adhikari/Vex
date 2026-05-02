/**
 * Mission tools — vex-agent only. MCP has no mission concept
 * (`missionRunId` is always null in MCP context); hide via `surface: "agent"`.
 */

import type { ToolDef } from "../types.js";

export const MISSION_TOOLS: readonly ToolDef[] = [
  {
    name: "mission_draft_update", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    surface: "agent",
    visibility: { requiresMissionSetup: true },
    description: "Save or update the mission draft during mission setup/edit. Call this before telling the user the mission draft is ready.",
    parameters: { type: "object", properties: {
      title: { type: "string", description: "Short mission title" },
      goal: { type: "string", description: "Mission goal or objective" },
      capitalSource: { type: "string", description: "Where starting capital comes from" },
      startingCapital: { type: "string", description: "Starting capital amount and asset" },
      allowedWallets: { type: "array", items: { type: "string" }, description: "Wallet addresses or wallet identifiers allowed for the mission" },
      allowedChains: { type: "array", items: { type: "string" }, description: "Allowed chains" },
      allowedProtocols: { type: "array", items: { type: "string" }, description: "Allowed protocols or venues" },
      riskProfile: { type: "string", description: "Risk profile such as conservative, moderate, or aggressive" },
      successCriteria: { type: "array", items: { type: "string" }, description: "Concrete success criteria" },
      stopConditions: { type: "array", items: { type: "string" }, description: "Conditions that stop the mission" },
      deadline: { type: "string", description: "Optional deadline, preferably ISO8601 or an absolute date/time with timezone" },
    }, additionalProperties: false },
  },
  {
    name: "mission_stop", kind: "internal", mutating: false,
    excludeRoles: ["subagent"],
    surface: "agent",
    visibility: { requiresMissionRun: true },
    description: "Stop the current mission run. Only valid during active mission execution. Use when a stop condition is met (goal reached, capital depleted, etc.).",
    parameters: { type: "object", properties: {
      reason: { type: "string", enum: ["goal_reached", "deadline_reached", "capital_depleted", "max_loss_hit", "no_viable_opportunity"], description: "Stop reason" },
      summary: { type: "string", description: "Concise explanation of why the mission should stop" },
      evidence: { type: "object", description: "Optional structured evidence / metrics" },
    }, required: ["reason", "summary"] },
  },
];
