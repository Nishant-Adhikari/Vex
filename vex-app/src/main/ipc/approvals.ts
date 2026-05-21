/**
 * Approvals IPC handlers — pending queue browsing + history are
 * read-only (allow-listed DTOs only — raw `tool_call` JSONB never
 * crosses the boundary). `approve`/`reject` fail-close with
 * `approvals.feature_unavailable` until puzzle 05 lands the durable
 * approval intents + idempotent runtime continuation.
 *
 * Today's `rejectApproval` path in the engine only flips the queue row
 * status; it doesn't write a safe tool-result rejection or transition
 * `paused_approval`. We refuse to ship a button that stalls runs in
 * `paused_approval` — fail-closed is the safer puzzle-1 default.
 */

import { CH } from "@shared/ipc/channels.js";
import { err, type Result } from "@shared/ipc/result.js";
import {
  approvalActionInputSchema,
  approvalActionResultSchema,
  approvalGetHistoryInputSchema,
  approvalGetInputSchema,
  approvalListPendingInputSchema,
  approvalSummaryDtoSchema,
  type ApprovalActionResult,
  type ApprovalSummaryDto,
} from "@shared/schemas/approvals.js";
import {
  getApprovalById,
  getHistoryForSession,
  listPendingForSession,
} from "../database/approvals-db.js";
import { log } from "../logger/index.js";
import { z } from "zod";
import { featureUnavailable } from "./_feature-unavailable.js";
import { registerHandler } from "./register-handler.js";

const approvalSummaryArraySchema = z.array(approvalSummaryDtoSchema);
const approvalSummaryNullableSchema = approvalSummaryDtoSchema.nullable();

function registerListPendingHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.listPending,
    domain: "approvals",
    inputSchema: approvalListPendingInputSchema,
    outputSchema: approvalSummaryArraySchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<ReadonlyArray<ApprovalSummaryDto>>> => {
      const outcome = await listPendingForSession(input.sessionId);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:approvals:listPending] ok sessionId=${input.sessionId} ` +
            `count=${outcome.data.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return { ok: true, data: [...outcome.data] };
      }
      log.info(
        `[ipc:vex:approvals:listPending] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGetHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.get,
    domain: "approvals",
    inputSchema: approvalGetInputSchema,
    outputSchema: approvalSummaryNullableSchema,
    handle: async (input, ctx): Promise<Result<ApprovalSummaryDto | null>> => {
      const outcome = await getApprovalById(input.id);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:approvals:get] ok id=${input.id} ` +
            `present=${outcome.data !== null} ` +
            `correlationId=${ctx.requestId}`,
        );
        return outcome;
      }
      log.info(
        `[ipc:vex:approvals:get] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerGetHistoryHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.getHistory,
    domain: "approvals",
    inputSchema: approvalGetHistoryInputSchema,
    outputSchema: approvalSummaryArraySchema,
    handle: async (
      input,
      ctx,
    ): Promise<Result<ReadonlyArray<ApprovalSummaryDto>>> => {
      const outcome = await getHistoryForSession(input.sessionId, input.limit);
      if (outcome.ok) {
        log.info(
          `[ipc:vex:approvals:getHistory] ok sessionId=${input.sessionId} ` +
            `count=${outcome.data.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return { ok: true, data: [...outcome.data] };
      }
      log.info(
        `[ipc:vex:approvals:getHistory] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

function registerActionHandler(channel: string, message: string): () => void {
  return registerHandler({
    channel,
    domain: "approvals",
    inputSchema: approvalActionInputSchema,
    outputSchema: approvalActionResultSchema,
    handle: async (_input, ctx): Promise<Result<ApprovalActionResult>> => {
      log.info(
        `[ipc:${channel}] fail-closed feature_unavailable ` +
          `correlationId=${ctx.requestId}`,
      );
      return err(
        featureUnavailable({
          domain: "approvals",
          correlationId: ctx.requestId,
          message,
        }),
      );
    },
  });
}

export function registerApprovalsHandlers(): ReadonlyArray<() => void> {
  return [
    registerListPendingHandler(),
    registerGetHandler(),
    registerGetHistoryHandler(),
    registerActionHandler(
      CH.approvals.approve,
      "Approval approve lands in puzzle 05 (durable intent + idempotent dispatch).",
    ),
    registerActionHandler(
      CH.approvals.reject,
      "Approval reject lands in puzzle 05 (safe tool-result rejection + resume).",
    ),
  ];
}
