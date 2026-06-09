/**
 * memory_candidates repo — public re-exports (controlled surface).
 */

export type {
  CandidateStatus,
  MemoryCandidate,
  MemoryCandidateRow,
  InsertCandidateInput,
  InsertCandidateResult,
  MemoryCandidateRecall,
  MemoryCandidateRecallRow,
} from "./types.js";

export { CANDIDATE_COLUMNS, mapRow, mapRecallRow } from "./types.js";

export {
  insertCandidate,
  getCandidateById,
  getCandidateEmbedding,
  findLatestCandidateByContentHash,
  updateCandidateStatus,
  listCandidatesByStatus,
  recallCandidatesTopK,
  type CandidateRecallFilters,
  type UpdateCandidateStatusPatch,
  type UpdateCandidateStatusResult,
} from "./crud.js";
