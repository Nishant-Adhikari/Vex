/**
 * Session-episodes repo — barrel over PR2 split.
 *
 * Sits between `sessions.summary` (rolling per-session) and
 * `knowledge_entries` (canonical, cross-session, curated). Episodes are
 * write-once; promotion to canonical knowledge lives in
 * `src/echo-agent/knowledge/promotion/` (see `session-episodes/promotion-queries.ts`
 * for the read-only queries the pipeline consumes).
 *
 * Public surface is unchanged post-PR2. Pre-split import `import * as
 * sessionEpisodesRepo from "@echo-agent/db/repos/session-episodes.js"` continues
 * to resolve every name below (types + functions).
 */

export {
  EPISODE_COLUMNS,
  EPISODE_KINDS,
  mapRow,
  type EpisodeKind,
  type NewEpisode,
  type RecallFilters,
  type RecallHit,
  type SessionEpisode,
  type SessionEpisodeRecallRow,
  type SessionEpisodeRow,
} from "./session-episodes/types.js";

export {
  getById,
  insertEpisodes,
  listRecentBySession,
} from "./session-episodes/crud.js";

export { recallTopK } from "./session-episodes/recall.js";

export {
  PROMOTABLE_KINDS,
  countSimilar,
  listPromotable,
  type PromotionCandidate,
} from "./session-episodes/promotion-queries.js";
