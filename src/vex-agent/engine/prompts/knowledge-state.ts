/**
 * Knowledge-state banner — informs the agent of the long-term knowledge base
 * size and top kinds. Empty state tells the agent to write entries via
 * knowledge_write (persona, strategies, lessons, observed user preferences).
 *
 * Built from `countActiveHotContextEntries` + `listKnownKinds` (PR1).
 */

import type { KnownKind } from "@vex-agent/db/repos/knowledge.js";

export interface KnowledgeStateInput {
  activeCount: number;
  topKinds: KnownKind[];
}

export function buildKnowledgeStateBanner(input: KnowledgeStateInput): string {
  if (input.activeCount === 0) {
    return [
      `[Knowledge: empty.`,
      `Long-term memory has no entries yet. Use knowledge_write to save: persona, strategies, lessons, observed user preferences.`,
      `Skip knowledge_recall — nothing to find.]`,
    ].join(" ");
  }
  const kindsLine =
    input.topKinds.length === 0
      ? ""
      : ` Top kinds: ${input.topKinds.map((k) => `${k.kind} (${k.count})`).join(", ")}.`;
  return [
    `[Knowledge: ${input.activeCount} entries.${kindsLine}`,
    `Tool: knowledge_recall(semantic_intent, k≤8).]`,
  ].join(" ");
}
