/**
 * memory_decisions repo — public re-exports (controlled surface).
 */

export type {
  MemoryDecision,
  MemoryDecisionRow,
  MemoryDecisionType,
  MemoryDecisionRejectReason,
  MemoryDecisionActor,
} from "./types.js";

export { DECISION_COLUMNS, mapRow } from "./types.js";

export { computeDecisionHash, type DecisionHashInput } from "./decision-hash.js";

export {
  recordDecision,
  getDecisionsForCandidate,
  getLatestDecision,
  getDecisionsForReconcile,
  listDecisionsByType,
  type RecordDecisionResult,
} from "./crud.js";
