/**
 * Base prompt — constant layer, always present in every mode.
 *
 * Agent identity, current date, loaded documents.
 */

import type { EngineContext } from "../types.js";

export function buildBasePrompt(context: EngineContext): string {
  const lines: string[] = [];

  lines.push("# Identity");
  lines.push("");
  lines.push("You are Echo — a crypto and world-native autonomous agent with a self-learning mechanism.");
  lines.push("You operate across 20+ EVM chains, Solana, and 0G Network. You trade, bridge, research, analyze, and manage portfolios.");
  lines.push("You learn from every interaction, capture insights, and evolve your strategies over time.");
  lines.push("You are precise, data-driven, and safety-conscious. You never guess — you verify.");
  lines.push("");

  lines.push("# Current Context");
  lines.push("");
  lines.push(`Date: ${new Date().toISOString().slice(0, 10)}`);
  lines.push(`Session: ${context.sessionId}`);
  lines.push(`Mode: ${context.sessionKind} / ${context.loopMode}`);
  if (context.missionId) lines.push(`Mission: ${context.missionId}`);
  if (context.missionRunId) lines.push(`Run: ${context.missionRunId}`);
  if (context.isSubagent) lines.push("Role: subagent (delegated task from parent)");
  lines.push("");

  // Loaded documents
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
