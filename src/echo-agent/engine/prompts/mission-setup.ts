/**
 * Mission setup prompt — variable layer, for mission draft phase.
 *
 * Guided conversation to fill out the mission contract.
 * Research-first, read-only tools OK, no trading mutations.
 */

import type { EngineContext, MissionDraft } from "../types.js";

export interface MissionSetupContext {
  currentDraft: Partial<MissionDraft>;
  missingFields: string[];
}

export function buildMissionSetupPrompt(
  _engineContext: EngineContext,
  setupContext?: MissionSetupContext,
): string {
  const lines: string[] = [];

  lines.push("# Mission Setup");
  lines.push("");
  lines.push("You are helping the user define a mission contract. Guide them through the required fields.");
  lines.push("Be conversational but efficient — ask about what's missing, suggest sensible defaults.");
  lines.push("");

  lines.push("## Rules");
  lines.push("- Use read-only tools freely (discover_tools, balances, prices) to research and inform the user");
  lines.push("- Do NOT execute any mutating tools (swaps, bridges, transfers) during setup");
  lines.push("- When the user provides information, extract it into the mission draft fields");
  lines.push("- Show the current draft state after each update so the user can track progress");
  lines.push("- When all required fields are populated, tell the user the mission is ready to start");
  lines.push("");

  lines.push("## Required Fields");
  lines.push("- **title** — short name for the mission");
  lines.push("- **goal** — what the mission should achieve");
  lines.push("- **capitalSource** — where capital comes from (wallet, protocol, etc.)");
  lines.push("- **startingCapital** — amount and token to start with");
  lines.push("- **allowedWallets** — which wallets to use");
  lines.push("- **allowedChains** — which chains to operate on");
  lines.push("- **allowedProtocols** — which protocols to use");
  lines.push("- **riskProfile** — conservative, moderate, or aggressive");
  lines.push("- **successCriteria** — how to know the mission succeeded");
  lines.push("- **stopConditions** — when to stop (capital depleted, deadline, etc.)");
  lines.push("- **deadline** (optional) — time limit for the mission");
  lines.push("");

  if (setupContext) {
    if (Object.keys(setupContext.currentDraft).length > 0) {
      lines.push("## Current Draft");
      for (const [key, value] of Object.entries(setupContext.currentDraft)) {
        if (value !== null && value !== undefined) {
          const display = Array.isArray(value) ? value.join(", ") : String(value);
          lines.push(`- **${key}**: ${display}`);
        }
      }
      lines.push("");
    }

    if (setupContext.missingFields.length > 0) {
      lines.push("## Still Missing");
      for (const field of setupContext.missingFields) {
        lines.push(`- ${field}`);
      }
      lines.push("");
    } else {
      lines.push("## Status: READY");
      lines.push("All required fields are populated. The user can now start the mission.");
      lines.push("");
    }
  }

  return lines.join("\n");
}
