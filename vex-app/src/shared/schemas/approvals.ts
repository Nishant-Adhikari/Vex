/**
 * Approvals schemas — pending queue + history summaries.
 *
 * Renderer NEVER receives the raw `approval_queue.tool_call` /
 * `pending_context` JSONB. The main-side mapper in
 * `vex-app/src/main/database/approvals-db.ts` is the single place
 * where those JSONB blobs get reduced to allow-listed DTO fields:
 *   - `toolName` (best-effort `namespace:command`),
 *   - `toolCallId`,
 *   - `permissionAtEnqueue`,
 *   - `reasoningPreview` (first 200 chars of `reasoning`).
 *
 * Pending approve/reject mutations fail closed with
 * `approvals.feature_unavailable` until puzzle 05 lands the durable
 * intents + idempotent runtime continuation. The Result-typed contract
 * ships now so the renderer hook surface compiles end-to-end.
 *
 * Field names match the canonical refs vocabulary in
 * `BUG-REPORTING.md §3` (`sessionId`, `toolCallId`, `toolName`).
 */

import { z } from "zod";

export const APPROVAL_REASONING_PREVIEW_MAX = 200;
export const APPROVAL_HISTORY_DEFAULT_LIMIT = 20;
export const APPROVAL_HISTORY_MAX_LIMIT = 100;

/** Mirrors the `approval_queue.status` CHECK from migration 001. */
export const approvalStatusSchema = z.enum([
  "pending",
  "approved",
  "rejected",
]);
export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;

/** Mirrors the `approval_queue.permission_at_enqueue` CHECK. */
export const approvalPermissionSchema = z.enum(["restricted", "full"]);
export type ApprovalPermission = z.infer<typeof approvalPermissionSchema>;

export const approvalSummaryDtoSchema = z
  .object({
    id: z.string().min(1),
    /**
     * `approval_queue.session_id` is nullable in the DB (the engine can
     * enqueue session-less approvals from non-chat sources). UI may
     * filter on this; the renderer surfaces the value as-is.
     */
    sessionId: z.string().uuid().nullable(),
    toolCallId: z.string().nullable(),
    /**
     * Best-effort tool identifier extracted from `tool_call` JSONB
     * (preferred: `namespace:command` when both are strings; fallback
     * `command`, `name`, finally `"unknown"`). Refined when tool
     * registry metadata is wired in puzzle 05.
     */
    toolName: z.string().nullable(),
    status: approvalStatusSchema,
    permissionAtEnqueue: approvalPermissionSchema,
    createdAt: z.string().datetime({ offset: true }),
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    /** First 200 chars of `approval_queue.reasoning`, no JSONB leakage. */
    reasoningPreview: z.string().max(APPROVAL_REASONING_PREVIEW_MAX),
  })
  .strict();
export type ApprovalSummaryDto = z.infer<typeof approvalSummaryDtoSchema>;

export const approvalListPendingInputSchema = z
  .object({
    sessionId: z.string().uuid(),
  })
  .strict();
export type ApprovalListPendingInput = z.infer<
  typeof approvalListPendingInputSchema
>;

export const approvalGetInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type ApprovalGetInput = z.infer<typeof approvalGetInputSchema>;

export const approvalGetHistoryInputSchema = z
  .object({
    sessionId: z.string().uuid(),
    limit: z
      .number()
      .int()
      .min(1)
      .max(APPROVAL_HISTORY_MAX_LIMIT)
      .default(APPROVAL_HISTORY_DEFAULT_LIMIT),
  })
  .strict();
export type ApprovalGetHistoryInput = z.infer<
  typeof approvalGetHistoryInputSchema
>;

export const approvalActionInputSchema = z
  .object({
    id: z.string().min(1),
  })
  .strict();
export type ApprovalActionInput = z.infer<typeof approvalActionInputSchema>;

/**
 * Future-shape contract for `approvals.approve`/`approvals.reject`.
 * Puzzle 1 fail-closes with `approvals.feature_unavailable`; puzzle 05
 * fills the body. The Result-typed contract is exported so renderer
 * hooks + preload validators compile against the eventual shape.
 */
export const approvalActionResultSchema = z
  .object({
    id: z.string().min(1),
    status: approvalStatusSchema,
    resolvedAt: z.string().datetime({ offset: true }).nullable(),
    /** Action outcome: did the decision actually resume runtime / dispatch the tool? */
    runtimeOutcome: z.enum(["resumed", "stopped", "unavailable"]),
    message: z.string(),
  })
  .strict();
export type ApprovalActionResult = z.infer<typeof approvalActionResultSchema>;
