/**
 * Approval runtime — post-tx result-message + execution-status mapping.
 *
 * After a resumed approved dispatch returns a controlled result
 * (`{ success, output }`), the execution status is marked from the result hash
 * and the approved tool-result is appended to the transcript so the mission
 * run can resume via continuation and observe the outcome. Both side effects
 * run AFTER the snapshot tx committed — a failure here is translated by the
 * caller into a `paused_error` flip + `ApprovalPostDecisionError`.
 */

import * as approvalIntentsRepo from "../../../../db/repos/approval-intents.js";
import { appendMessage } from "../../../events/index.js";
import { shortSha256, toIsoNow } from "../helpers.js";

/**
 * Map a controlled dispatch result to `succeeded`/`failed` execution status,
 * keyed by a short hash of the result so retries are correlatable.
 */
export async function markApprovedExecutionStatus(
  approvalId: string,
  dispatchResult: { success: boolean; output: string },
): Promise<void> {
  const resultHash = shortSha256(
    JSON.stringify({
      success: dispatchResult.success,
      output: dispatchResult.output,
    }),
  );
  await approvalIntentsRepo.markExecutionStatus(
    approvalId,
    dispatchResult.success ? "succeeded" : "failed",
    resultHash,
  );
}

/**
 * Append the approved tool-result to the transcript. Unlike the dispatch-throw
 * and rejection appends, this carries the real dispatch output because the user
 * explicitly approved the action.
 */
export async function appendApprovedToolResult(
  sessionId: string,
  toolCallId: string,
  dispatchResult: { success: boolean; output: string },
): Promise<void> {
  await appendMessage(
    sessionId,
    {
      role: "tool",
      content: dispatchResult.output,
      toolCallId,
      timestamp: toIsoNow(),
    },
    {
      source: "tool",
      messageType: "tool_result",
      visibility: "internal",
      payload: { success: dispatchResult.success },
    },
  );
}
