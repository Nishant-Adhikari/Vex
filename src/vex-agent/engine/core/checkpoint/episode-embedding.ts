import type { NewEpisode } from "@vex-agent/db/repos/session-episodes.js";
import { embedDocument } from "@vex-agent/embeddings/client.js";
import type { ExtractedEpisode } from "@vex-agent/engine/checkpoint/extract.js";
import logger from "@utils/logger.js";

/** Fallback title hint length - matches the pre-PR2 slice(0, 120) cap. */
const TITLE_FALLBACK_CHARS = 120;

export async function embedAllEpisodes(args: {
  extracted: readonly ExtractedEpisode[];
  sessionId: string;
  memoryScopeKey: string;
  sourceStartMessageId: number | null;
  sourceEndMessageId: number | null;
}): Promise<NewEpisode[]> {
  if (args.extracted.length === 0) return [];

  const rows: NewEpisode[] = [];
  for (const episode of args.extracted) {
    try {
      // LLM-generated title is authoritative post-PR2. Fallback to the
      // truncated summary when the LLM omitted it.
      const titleHint =
        episode.title.trim().length > 0
          ? episode.title
          : episode.summaryText.slice(0, TITLE_FALLBACK_CHARS);
      const { embedding, providerModel } = await embedDocument(titleHint, episode.summaryText);
      rows.push({
        sessionId: args.sessionId,
        memoryScopeKey: args.memoryScopeKey,
        episodeKind: episode.episodeKind,
        title: episode.title,
        summaryText: episode.summaryText,
        facts: episode.facts,
        decisions: episode.decisions,
        openLoops: episode.openLoops,
        entities: episode.entities,
        toolOutcomes: episode.toolOutcomes,
        sourceSession: args.sessionId,
        sourceStartMessageId: args.sourceStartMessageId,
        sourceEndMessageId: args.sourceEndMessageId,
        episodeHash: episode.episodeHash,
        embeddingModel: providerModel,
        embeddingDim: embedding.length,
        embedding,
      });
    } catch (err) {
      logger.warn("checkpoint.embed.failed", {
        error: err instanceof Error ? err.message : String(err),
        episodeKind: episode.episodeKind,
      });
    }
  }
  return rows;
}
