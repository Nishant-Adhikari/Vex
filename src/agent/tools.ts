/**
 * System prompt builder.
 *
 * Builds the agent's system prompt from soul.md, memory.md, loaded knowledge,
 * SKILL.md capabilities, and behavior rules.
 *
 * Tool definitions are NOT injected here — they go through the native OpenAI
 * `tools` parameter in inference.ts via tool-registry.ts.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as soulRepo from "./db/repos/soul.js";
import * as memoryRepo from "./db/repos/memory.js";
import * as skillsRepo from "./db/repos/skills.js";
import type { ChatMode } from "./types.js";
import { getBehaviorInstructions } from "./prompts/behavior.js";
import { buildFirstConversationPrompt } from "./prompts/identity.js";
import { buildCurrentDateSection, buildLoadedKnowledgeSection, getModeDescription } from "./prompts/system.js";
import { getActiveCount } from "./subagent.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load EchoClaw-internal skill doc (not shared with external frameworks). */
function loadInternalSkill(filename: string): string | null {
  try {
    return readFileSync(join(__dirname, "skills", filename), "utf-8");
  } catch {
    return null;
  }
}

// ── System prompt builder ────────────────────────────────────────────

export async function buildSystemPrompt(
  loadedKnowledgeFiles: Map<string, string> = new Map(),
  loopMode: ChatMode = "off",
): Promise<string> {
  const parts: string[] = [];

  parts.push(getModeDescription(loopMode));

  // Identity (from DB)
  const soulData = await soulRepo.getSoul();
  if (soulData?.content) {
    parts.push("# Identity\n\n" + soulData.content);
  } else {
    parts.push(buildFirstConversationPrompt());
  }

  // Memory (from DB) — cap to 50 entries in manual mode to reduce prompt size
  const memoryLimit = loopMode === "off" ? 50 : undefined;
  const memory = await memoryRepo.getMemoryAsText(memoryLimit);
  if (memory) {
    parts.push("# Memory\n\n" + memory);
  }

  parts.push(buildCurrentDateSection());

  const loadedKnowledgeSection = buildLoadedKnowledgeSection(loadedKnowledgeFiles);
  if (loadedKnowledgeSection) {
    parts.push(loadedKnowledgeSection);
  }

  // Agent capabilities — skip full SKILL.md in manual mode (saves ~3-5k tokens)
  if (loopMode !== "off") {
    const skillMd = await skillsRepo.getSkillReference("SKILL.md");
    if (skillMd) {
      parts.push("# Agent Capabilities (echoclaw CLI)\n\n" + skillMd);
    }

    // EchoClaw-internal skills (not shared with external frameworks)
    const subagentSkill = loadInternalSkill("subagents.md");
    if (subagentSkill) {
      parts.push(subagentSkill);
    }
  } else {
    parts.push("# Agent Capabilities\n\nYou have CLI tools for blockchain operations across 0G, Solana, and EVM chains. Load reference docs (file_read) before first use of any CLI command domain.");
  }

  // Behavior rules — mode-aware (manual gets lighter prompt)
  parts.push(getBehaviorInstructions(loopMode));

  return parts.join("\n\n---\n\n");
}
