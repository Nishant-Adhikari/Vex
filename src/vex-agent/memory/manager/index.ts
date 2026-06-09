/**
 * memory_manager module barrel — INTERNAL use-case functions only (FIX-3).
 *
 * NOTHING here is a ToolDef, and nothing is registered in the tool
 * registry / visibility / tool-map. The async memory_manager worker (S4
 * executor) consumes these functions; the agent never reaches them.
 */

export {
  consolidateCandidate,
  applyDecisionAtomically,
  defaultConsolidateDeps,
  ClaimLostError,
  getCandidateById,
  getCandidateEmbedding,
  type ConsolidateDeps,
  type CandidateDecision,
  type AtomicApplyResult,
} from "./consolidate.js";

export {
  applyDecision,
  promote,
  supersedeFromCandidate,
  applyTerminal,
  PromoteRedactionAnomalyError,
  type DecisionPlan,
  type ApplyDecisionResult,
} from "./promote.js";

export {
  runDeterministicStage,
  type DeterministicVerdict,
  type DeterministicInput,
  type EscalationSignals,
  type KnowledgeMatch,
} from "./deterministic-stage.js";

export {
  derefAnchorExistence,
  countRecurrence,
  deriveEvidenceStrengthCeiling,
  type AnchorExistenceResult,
  type AnchorDerefDeps,
} from "./evidence-deref.js";

export { buildJudgeContext, type JudgeContext } from "./context-builder.js";
export { callJudge, type JudgeProvider, type JudgeCallResult } from "./judge.js";
export {
  judgeVerdictSchema,
  type JudgeVerdict,
  type JudgeVerdictType,
  type JudgeRubric,
} from "./judge-schema.js";
export { buildJudgeSystemPrompt, buildJudgeUserPrompt } from "./judge-prompt.js";
export { isGeneralizationKind, isTradeKind } from "./kind-families.js";
