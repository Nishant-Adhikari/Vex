/**
 * Mode picker — session kind + optional initial prompt / mission goal.
 *
 * Values align with what the downstream shell understands:
 *   - "chat"            → `/session new chat`, nothing auto-sent
 *   - "mission"         → chat session + `processMissionSetupTurn(goal)` on start
 *   - "full_autonomous" → `/session new full_autonomous`, optional initial prompt
 *
 * Operator goal / initial prompt is captured here so the Ink app can submit
 * it as the first turn automatically after mounting.
 */

import { isCancel, select, text } from "@clack/prompts";

export type WizardMode = "chat" | "mission" | "full_autonomous";

export interface ModeOutcome {
  aborted: boolean;
  mode: WizardMode;
  /** Mission goal (mode="mission") or full-autonomous seed (mode="full_autonomous"). */
  initialPrompt?: string;
  /** Mission-only — loop mode passed to `startMission`. */
  loopMode?: "off" | "restricted" | "full";
}

export async function runModeStep(): Promise<ModeOutcome> {
  const picked = await select<WizardMode>({
    message: "Which session should this shell drive?",
    initialValue: "chat",
    options: [
      {
        value: "chat",
        label: "Chat",
        hint: "Free-form Q&A with tool-calls; model replies each turn.",
      },
      {
        value: "mission",
        label: "Mission",
        hint: "Goal-oriented run with mission_stop; approvals in restricted mode.",
      },
      {
        value: "full_autonomous",
        label: "Full autonomous",
        hint: "Continuous worker driven by loop_defer + wake executor.",
      },
    ],
  });
  if (isCancel(picked)) return { aborted: true, mode: "chat" };

  if (picked === "mission") {
    const goal = await text({
      message: "Mission goal (one sentence or short paragraph)",
      placeholder: "e.g. Bridge 10 USDC from Arbitrum to Base for under 1% fee",
      validate: (v) => ((v?.trim().length ?? 0) >= 5 ? undefined : "At least 5 characters"),
    });
    if (isCancel(goal)) return { aborted: true, mode: picked };

    const loopMode = await select<"off" | "restricted" | "full">({
      message: "Mission loop mode",
      initialValue: "restricted",
      options: [
        {
          value: "off",
          label: "off",
          hint: "No proactive actions; model asks before every tool call.",
        },
        {
          value: "restricted",
          label: "restricted (recommended)",
          hint: "Read-only freely; mutations go through approval queue.",
        },
        {
          value: "full",
          label: "full",
          hint: "Full authority — no approval gates. Only when you trust the mission.",
        },
      ],
    });
    if (isCancel(loopMode)) return { aborted: true, mode: picked };

    return {
      aborted: false,
      mode: picked,
      initialPrompt: String(goal).trim(),
      loopMode,
    };
  }

  if (picked === "full_autonomous") {
    const prompt = await text({
      message: "Initial prompt for the autonomous worker (optional — press Enter to skip)",
      placeholder: "e.g. Monitor TRUMP price; defer 1h; alert on >10% move",
    });
    if (isCancel(prompt)) return { aborted: true, mode: picked };
    const trimmed = String(prompt).trim();
    return {
      aborted: false,
      mode: picked,
      initialPrompt: trimmed.length > 0 ? trimmed : undefined,
    };
  }

  return { aborted: false, mode: picked };
}
