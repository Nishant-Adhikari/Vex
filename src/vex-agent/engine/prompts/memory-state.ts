/**
 * Memory-state banner — informs the agent how many narrative memory chunks
 * exist for this session and how many compacts have happened. Empty state
 * tells the agent NOT to call memory_recall (nothing to find yet).
 *
 * Built from `getSessionMemoryStats` (single round-trip CTE in PR1).
 */

import type { SessionMemoryStats } from "@vex-agent/db/repos/session-memories/index.js";

export function buildMemoryStateBanner(stats: SessionMemoryStats): string {
  if (stats.activeCount === 0) {
    return [
      `[Session memories: 0 chunks, ${stats.compactCount} compact(s) done.`,
      `Skip memory_recall — nothing to find.`,
      `Chunks become available after the first compact at ~88% context, produced asynchronously by Track 2.]`,
    ].join(" ");
  }
  const themesLine =
    stats.recentThemes.length === 0
      ? ""
      : ` Recent themes: ${stats.recentThemes.join(", ")}.`;
  const outstandingLine =
    stats.unresolvedOutstandingCount > 0
      ? ` ${stats.unresolvedOutstandingCount} outstanding item(s) unresolved.`
      : "";
  return [
    `[Session memories: ${stats.activeCount} chunk(s) across ${stats.compactCount} compact(s).${outstandingLine}${themesLine}`,
    `Tool: memory_recall(semantic_intent, k≤5).]`,
  ].join(" ");
}
