/**
 * Approvals IPC — read-only handlers (list pending / get / history).
 *
 * Allow-listed DTOs only; raw `tool_call` JSONB never crosses the boundary.
 * Unchanged from puzzle 1.
 */

import { CH } from "@shared/ipc/channels.js";
import { type Result } from "@shared/ipc/result.js";
import {
  approvalGetHistoryInputSchema,
  approvalGetInputSchema,
  approvalListPendingAllInputSchema,
  approvalListPendingInputSchema,
  approvalPendingGlobalDtoSchema,
  approvalSummaryDtoSchema,
  type ApprovalPendingGlobalDto,
  type ApprovalSummaryDto,
} from "@shared/schemas/approvals.js";
import {
  getApprovalById,
  getHistoryForSession,
  listPendingAllApprovals,
  listPendingForSession,
} from "../../database/approvals-db.js";
import { log } from "../../logger/index.js";
import { z } from "zod";
import { registerHandler } from "../register-handler.js";

const approvalSummaryArraySchema = z.array(approvalSummaryDtoSchema);
const approvalSummaryNullableSchema = approvalSummaryDtoSchema.nullable();
const approvalPendingGlobalArraySchema = z.array(
  approvalPendingGlobalDtoSchema,
);

// ── Read handlers (unchanged from puzzle 1) ─────────────────────────────

export function registerListPendingHandler(): () => void {
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

/**
 * App-wide pending inbox (DESK RULE global affordance). Same allow-listed
 * boundary as `listPending` but session-agnostic: takes the strict empty
 * input and returns the global DTO (summary + session title). Logs count only
 * — never the rows.
 */
export function registerListPendingAllHandler(): () => void {
  return registerHandler({
    channel: CH.approvals.listPendingAll,
    domain: "approvals",
    inputSchema: approvalListPendingAllInputSchema,
    outputSchema: approvalPendingGlobalArraySchema,
    handle: async (
      _input,
      ctx,
    ): Promise<Result<ReadonlyArray<ApprovalPendingGlobalDto>>> => {
      const outcome = await listPendingAllApprovals();
      if (outcome.ok) {
        log.info(
          `[ipc:vex:approvals:listPendingAll] ok ` +
            `count=${outcome.data.length} ` +
            `correlationId=${ctx.requestId}`,
        );
        return { ok: true, data: [...outcome.data] };
      }
      log.info(
        `[ipc:vex:approvals:listPendingAll] errCode=${outcome.error.code} ` +
          `correlationId=${ctx.requestId}`,
      );
      return outcome;
    },
  });
}

export function registerGetHandler(): () => void {
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

export function registerGetHistoryHandler(): () => void {
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
