/**
 * Subagent child tools — request_parent, report_complete.
 */

import * as subagentsRepo from "@echo-agent/db/repos/subagents.js";
import * as sessionLinksRepo from "@echo-agent/db/repos/session-links.js";
import * as subagentMessagesRepo from "@echo-agent/db/repos/subagent-messages.js";
import type { ToolResult } from "../../types.js";
import type { InternalToolContext } from "../types.js";
import { str, fail } from "../types.js";
import logger from "@utils/logger.js";

// ── subagent_request_parent (child → parent) ────────────────────

export async function handleSubagentRequestParent(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const question = str(params, "question");
  if (!question) return fail("Missing required: question");

  // Find subagent by session (child calls this, context.sessionId is child session)
  const link = await sessionLinksRepo.getParentSession(context.sessionId);
  if (!link?.subagentId) return fail("Not a subagent session — cannot request parent");
  const subagentId = link.subagentId;

  const messageId = await subagentMessagesRepo.sendStructuredMessage(
    subagentId, "to_parent", question, "request_parent",
    { question, context: str(params, "context") || undefined },
  );

  await subagentsRepo.updateStatus(subagentId, "waiting_for_parent");

  logger.info("subagent.request_parent", { id: subagentId, messageId });

  return {
    success: true,
    output: `Request sent to parent (message #${messageId}). Waiting for reply...`,
    data: { messageId, subagentId },
    engineSignal: {
      type: "wait_for_parent",
      reason: "waiting_for_parent",
      summary: question,
      messageId,
    },
  };
}

// ── subagent_report_complete (child → parent) ───────────────────

export async function handleSubagentReportComplete(
  params: Record<string, unknown>,
  context: InternalToolContext,
): Promise<ToolResult> {
  const summary = str(params, "summary");
  if (!summary) return fail("Missing required: summary");

  const link = await sessionLinksRepo.getParentSession(context.sessionId);
  if (!link?.subagentId) return fail("Not a subagent session");
  const subagentId = link.subagentId;

  const findings = typeof params.findings === "object" && params.findings !== null
    ? params.findings as Record<string, unknown> : undefined;

  // 1. Save structured report FIRST
  await subagentMessagesRepo.sendStructuredMessage(
    subagentId, "to_parent", summary, "report_complete",
    { summary, findings, success: params.success !== false },
  );

  logger.info("subagent.report_complete", { id: subagentId, summary: summary.slice(0, 100) });

  // 2. THEN return engineSignal to end child run
  return {
    success: true,
    output: `Report submitted to parent: ${summary}`,
    data: { subagentId, summary, findings },
    engineSignal: {
      type: "complete_subagent",
      reason: "goal_reached",
      summary,
      evidence: findings,
    },
  };
}
