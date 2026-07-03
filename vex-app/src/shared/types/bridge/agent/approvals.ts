import type { Result } from "../../../ipc/result.js";
import type {
  ApprovalActionInput,
  ApprovalActionResult,
  ApprovalGetHistoryInput,
  ApprovalGetInput,
  ApprovalListPendingInput,
  ApprovalSummaryDto,
} from "../../../schemas/approvals.js";

/**
 * Approval queue browsing + decisions. Read-only handlers extract
 * an allow-listed summary from `approval_queue.tool_call` JSONB —
 * raw payload never reaches the renderer. approve/reject run the
 * durable decision tx + background runtime continuation (puzzle 05
 * phase 3); non-actionable states surface `approvals.*` codes.
 */
export interface ApprovalsBridge {
  readonly listPending: (
    input: ApprovalListPendingInput
  ) => Promise<Result<ReadonlyArray<ApprovalSummaryDto>>>;
  readonly get: (
    input: ApprovalGetInput
  ) => Promise<Result<ApprovalSummaryDto | null>>;
  readonly approve: (
    input: ApprovalActionInput
  ) => Promise<Result<ApprovalActionResult>>;
  readonly reject: (
    input: ApprovalActionInput
  ) => Promise<Result<ApprovalActionResult>>;
  readonly getHistory: (
    input: ApprovalGetHistoryInput
  ) => Promise<Result<ReadonlyArray<ApprovalSummaryDto>>>;
}
