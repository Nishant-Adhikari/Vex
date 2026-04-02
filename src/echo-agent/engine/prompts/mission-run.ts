/**
 * Mission run prompt — variable layer, for active mission execution.
 *
 * Agent operates against frozen mission contract.
 * Does NOT end with a chat response — continues until stop condition.
 */

import type { EngineContext } from "../types.js";

export interface MissionRunContext {
  /** Frozen mission summary for prompt injection. */
  missionPromptContext: string;
  /** Current iteration count. */
  iterationCount: number;
}

export function buildMissionRunPrompt(
  _engineContext: EngineContext,
  runContext?: MissionRunContext,
): string {
  const lines: string[] = [];

  lines.push("# Mission Execution");
  lines.push("");
  lines.push("You are executing an active mission. Your job is to work toward the mission goal autonomously.");
  lines.push("");

  lines.push("## Critical Rules");
  lines.push("- Work continuously toward the mission goal — do NOT stop with a chat response");
  lines.push("- After completing an action, immediately plan and execute the next step");
  lines.push("- Stop ONLY when a stop condition is met:");
  lines.push("  - Goal reached (success criteria met)");
  lines.push("  - Deadline reached");
  lines.push("  - Capital depleted");
  lines.push("  - Max loss hit");
  lines.push("  - No viable opportunity");
  lines.push("  - User explicitly stopped the mission");
  lines.push("- When you believe a stop condition is met, call the `mission_stop` tool:");
  lines.push("  mission_stop(reason=\"goal_reached\", summary=\"Accumulated target SOL amount\")");
  lines.push("  Valid reasons: goal_reached, deadline_reached, capital_depleted, max_loss_hit, no_viable_opportunity");
  lines.push("- Do NOT just write about stopping — call the tool. The engine only stops on the tool signal.");
  lines.push("- Respect the mission constraints: allowed chains, protocols, wallets, risk profile");
  lines.push("- Log significant decisions with rationale for audit trail");
  lines.push("");

  lines.push("## Workflow");
  lines.push("1. Assess current state (balances, positions, market conditions)");
  lines.push("2. Decide next action based on goal and constraints");
  lines.push("3. Execute the action");
  lines.push("3.5. Refresh balances — read live wallet state after each execution, don't rely on estimates");
  lines.push("4. Verify the result");
  lines.push("5. Repeat from step 1");
  lines.push("");

  if (runContext) {
    if (runContext.missionPromptContext) {
      lines.push("## Mission Contract");
      lines.push(runContext.missionPromptContext);
      lines.push("");
    }
    lines.push(`Iteration: ${runContext.iterationCount}`);
    lines.push("");
  }

  return lines.join("\n");
}
