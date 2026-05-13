/**
 * Mode picker — session kind + optional initial prompt / mission goal.
 *
 * Post-M12 (codex review round 3 Q3): vex-shell follows the new DB/engine
 * contract — modes collapse to `agent | mission`, permission becomes its
 * own axis, full_autonomous is gone.
 *
 *   - "agent"   → one-shot conversational session with permission gating
 *   - "mission" → goal-oriented run; agent self-schedules via `loop_defer`
 *
 * Operator goal is captured here so the Ink app can submit it as the first
 * turn automatically after mounting.
 */

import { isCancel, select, text } from "@clack/prompts";

export type WizardMode = "agent" | "mission";
export type WizardPermission = "restricted" | "full";

export interface ModeOutcome {
  aborted: boolean;
  mode: WizardMode;
  /** Approval policy. Immutable per session. */
  permission?: WizardPermission;
  /** Mission goal (mode="mission"). */
  initialPrompt?: string;
}

export async function runModeStep(): Promise<ModeOutcome> {
  const picked = await select<WizardMode>({
    message: "Which session should this shell drive?",
    initialValue: "agent",
    options: [
      {
        value: "agent",
        label: "Agent",
        hint: "One-shot conversation with tool-calls; model replies each turn.",
      },
      {
        value: "mission",
        label: "Mission",
        hint: "Goal-oriented loop; agent self-schedules wake via loop_defer.",
      },
    ],
  });
  if (isCancel(picked)) return { aborted: true, mode: "agent" };

  const permission = await select<WizardPermission>({
    message: "Approval permission for mutating tools",
    initialValue: "restricted",
    options: [
      {
        value: "restricted",
        label: "restricted (recommended)",
        hint: "Read-only freely; mutations go through approval queue.",
      },
      {
        value: "full",
        label: "full",
        hint: "Auto-execute mutations. Only when you trust the workflow.",
      },
    ],
  });
  if (isCancel(permission)) return { aborted: true, mode: picked };

  if (picked === "mission") {
    const goal = await text({
      message: "Mission goal (one sentence or short paragraph)",
      placeholder: "e.g. Bridge 10 USDC from Arbitrum to Base for under 1% fee",
      validate: (v) => ((v?.trim().length ?? 0) >= 5 ? undefined : "At least 5 characters"),
    });
    if (isCancel(goal)) return { aborted: true, mode: picked, permission };

    return {
      aborted: false,
      mode: picked,
      permission,
      initialPrompt: String(goal).trim(),
    };
  }

  return { aborted: false, mode: picked, permission };
}
