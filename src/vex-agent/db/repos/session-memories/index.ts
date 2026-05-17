/**
 * Session-memories repo — public re-exports.
 *
 * Consumers should import from `@vex-agent/db/repos/session-memories` to
 * avoid coupling to internal file layout.
 */

export type {
  OutstandingItem,
  NewOutstandingItem,
  SessionMemory,
  NewSessionMemory,
  RecallFilters,
  RecallHit,
  SessionMemoryRow,
  SessionMemoryRecallRow,
} from "./types.js";

export {
  BODY_MD_SCHEMA_VERSION,
  newOutstandingItem,
  renderBodyMd,
  computeContentHash,
  mapRow,
  MEMORY_COLUMNS,
} from "./types.js";

export {
  insertMemories,
  getById,
  listActiveBySession,
  getSessionMemoryStats,
  markOutstandingResolved,
  updateEmbedding,
  type InsertResult,
  type SessionMemoryStats,
  type ResolveOutstandingResult,
} from "./crud.js";

export { recallTopK } from "./recall.js";
