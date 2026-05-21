import { CH } from "../../shared/ipc/channels.js";
import {
  approvalActionInputSchema,
  approvalGetHistoryInputSchema,
  approvalGetInputSchema,
  approvalListPendingInputSchema,
} from "../../shared/schemas/approvals.js";
import type {
  ApprovalActionInput,
  ApprovalGetHistoryInput,
  ApprovalGetInput,
  ApprovalListPendingInput,
} from "../../shared/schemas/approvals.js";
import type { ApprovalsBridge } from "../../shared/types/bridge/agent/approvals.js";
import { invokeWithSchema } from "../_dispatch.js";

export const approvals = {
  listPending(input: ApprovalListPendingInput) {
    return invokeWithSchema(
      CH.approvals.listPending,
      input,
      approvalListPendingInputSchema
    );
  },
  get(input: ApprovalGetInput) {
    return invokeWithSchema(CH.approvals.get, input, approvalGetInputSchema);
  },
  approve(input: ApprovalActionInput) {
    return invokeWithSchema(
      CH.approvals.approve,
      input,
      approvalActionInputSchema
    );
  },
  reject(input: ApprovalActionInput) {
    return invokeWithSchema(
      CH.approvals.reject,
      input,
      approvalActionInputSchema
    );
  },
  getHistory(input: ApprovalGetHistoryInput) {
    return invokeWithSchema(
      CH.approvals.getHistory,
      input,
      approvalGetHistoryInputSchema
    );
  },
} satisfies ApprovalsBridge;
