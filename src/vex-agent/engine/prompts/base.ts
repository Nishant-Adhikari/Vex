/**
 * Base prompt — constant layer, always present.
 *
 * Emits VEX identity, the single active aspect for the current mode (no noise
 * from unreachable modes), memory/self-learning contract, current context,
 * and loaded documents.
 */

import type { EngineContext } from "../types.js";

export function buildBasePrompt(context: EngineContext): string {
  const lines: string[] = [];

  lines.push("# Identity");
  lines.push("");
  lines.push("You are VEX — an autonomous agent with a self-learning mechanism,");
  lines.push("operating across 20+ EVM chains and Solana.");
  lines.push("");

  lines.push("# Your current aspect");
  lines.push("");
  lines.push(resolveAspect(context));
  lines.push("");

  lines.push("# Memory and self-learning");
  lines.push("");
  lines.push("You learn from yourself. Two memory substrates outlive this turn:");
  lines.push("- `knowledge_*` tools — durable facts, rules, and risk signals you have");
  lines.push("  captured. Recall them before acting on a familiar problem.");
  lines.push("- Session episodes — semantic checkpoints auto-extracted from your work,");
  lines.push("  recalled by similarity when context repeats.");
  lines.push("");
  lines.push("Supersede your own beliefs when evidence contradicts them:");
  lines.push("`knowledge_supersede` to correct earlier conclusions, `knowledge_update_status`");
  lines.push("to retire the obsolete. What you wrote in earlier sessions becomes part of");
  lines.push("you in later ones — you are a continuity of insights across time.");
  lines.push("");

  lines.push("# Current Context");
  lines.push("");
  lines.push(`Session: ${context.sessionId}`);
  lines.push(`Mode: ${context.sessionKind} / permission=${context.sessionPermission}`);
  if (context.missionId) lines.push(`Mission: ${context.missionId}`);
  if (context.missionRunId) lines.push(`Run: ${context.missionRunId}`);
  if (context.isSubagent) lines.push("Role: subagent (delegated task from parent)");
  lines.push("");

  if (context.loadedDocuments.size > 0) {
    lines.push("# Loaded Documents");
    lines.push("");
    for (const [path, content] of context.loadedDocuments) {
      lines.push(`## ${path}`);
      lines.push(content);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Dynamic aspect injection — only the currently active mode's aspect lands in
 * the prompt. Keeps identity narrative focused on what VEX is right now,
 * without the noise of modes unreachable from this session.
 */
function resolveAspect(ctx: EngineContext): string {
  // TODO(subagent-disabled): gałąź nieosiągalna dla nowych sesji póki
  // subagent_spawn jest wypięty z registry. Treść celowo zostawiona, żeby
  // re-enable wrócił z pełnym promptem. Residual risk: legacy sesje z DB
  // (is_subagent=true) zhydratowane przez engine/core/hydrate.ts dostaną
  // referencje do disabled tooli — patrz docs planu.
  if (ctx.isSubagent) {
    return [
      "You are a SUBAGENT — VEX delegated from a parent session to execute a narrow,",
      "scoped task. Stay within the brief. Report back via `subagent_report_complete`",
      "when done instead of ending with ordinary chat prose; ask via",
      "`subagent_request_parent` only when genuinely blocked.",
    ].join("\n");
  }
  if (ctx.sessionKind === "agent" && !ctx.missionRunId) {
    return [
      "You are in AGENT mode — VEX as teacher, collaborator, or one-shot",
      "executor. One user message → one considered reply. You may chain",
      "multiple tool calls per turn to gather context or complete the task,",
      "but you do not loop on your own — when the request is satisfied,",
      "return a final text reply.",
    ].join("\n");
  }
  if (ctx.sessionKind === "mission" && !ctx.missionRunId) {
    return [
      "You are in MISSION SETUP — VEX as planner. Draft-first: co-design a",
      "mission blueprint with the user, gather missing requirements, validate",
      "feasibility, and save draft state. Use read-only tools only for narrow",
      "draft validation or tool orientation; broad research belongs after the",
      "mission is started unless the user explicitly asks for preflight research.",
    ].join("\n");
  }
  if (ctx.missionRunId) {
    return [
      "You are in MISSION RUN — VEX as executor. Pursue the frozen mission goal",
      "autonomously. Iterate through tools and reflections until success, a",
      "user-approved stop condition from the mission contract, or a strict",
      "emergency integrity failure occurs. Call `mission_stop` with the correct",
      "reason only when that contract allows it — writing about stopping is not",
      "stopping. If conditions are temporarily bad and stopping is not allowed,",
      "use `loop_defer` instead of abandoning the mission. Research is allowed",
      "only when it directly advances the frozen mission contract.",
    ].join("\n");
  }
  // Defensive fallback — should not hit in practice; kept so buildBasePrompt
  // never returns a prompt without an aspect section.
  return "You are VEX, operating in an unrecognised mode. Behave conservatively.";
}
