import {
  computeEpisodeHash,
  type ExtractedEpisode,
} from "@vex-agent/engine/checkpoint/extract.js";
import { GIANT_TOOL_THRESHOLD } from "@vex-agent/engine/checkpoint/prefix.js";

export function synthesizeToolResultSummary(bloatedContent: string): ExtractedEpisode {
  const preview = bloatedContent.slice(0, GIANT_TOOL_THRESHOLD / 2).trim();
  const summary =
    `Oversized tool output (${bloatedContent.length} chars) archived verbatim. ` +
    `Leading excerpt: ${preview}`;
  const clamped = summary.slice(0, 2000);
  return {
    episodeKind: "tool_result_summary",
    title: "Oversized tool output (archived)",
    summaryText: clamped,
    facts: {},
    decisions: {},
    openLoops: {},
    entities: [],
    toolOutcomes: {},
    episodeHash: computeEpisodeHash("tool_result_summary", clamped),
  };
}

export function buildGiantToolPlaceholder(
  bloatedMessageId: number,
  episodeId: number | undefined,
): string {
  const episodeRef = episodeId !== undefined ? `#${episodeId}` : "";
  return (
    `[tool_result_summary${episodeRef} — full payload archived at message_id=${bloatedMessageId}. ` +
    `Ask the operator for replay if needed.]`
  );
}
