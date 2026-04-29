/**
 * Subagent relay — message passing parent ↔ child.
 *
 * Supports plain-text relay (backward compat) and structured messages
 * (request_parent, reply, report_complete).
 */

import * as subagentMessages from "@vex-agent/db/repos/subagent-messages.js";
import type { SubagentMessageType, SubagentMessage } from "@vex-agent/db/repos/subagent-messages.js";

/** Relay plain text to parent (backward compat). */
export async function relayToParent(subagentId: string, content: string): Promise<void> {
  await subagentMessages.sendMessage(subagentId, "to_parent", content);
}

/** Relay plain text to child (backward compat). */
export async function relayToChild(subagentId: string, content: string): Promise<void> {
  await subagentMessages.sendMessage(subagentId, "to_child", content);
}

/** Send a structured message to parent. */
export async function sendStructuredToParent(
  subagentId: string,
  content: string,
  messageType: SubagentMessageType,
  payload?: Record<string, unknown>,
  replyTo?: number,
): Promise<number> {
  return subagentMessages.sendStructuredMessage(subagentId, "to_parent", content, messageType, payload, replyTo);
}

/** Send a structured message to child. */
export async function sendStructuredToChild(
  subagentId: string,
  content: string,
  messageType: SubagentMessageType,
  payload?: Record<string, unknown>,
  replyTo?: number,
): Promise<number> {
  return subagentMessages.sendStructuredMessage(subagentId, "to_child", content, messageType, payload, replyTo);
}

/** Get unhandled messages from child (parent reads these). */
export async function getUnhandledFromChild(subagentId: string): Promise<SubagentMessage[]> {
  return subagentMessages.getUnhandled(subagentId, "to_parent");
}

export async function getMessagesToParent(subagentId: string) {
  return subagentMessages.getMessagesByDirection(subagentId, "to_parent");
}

export async function getMessagesToChild(subagentId: string) {
  return subagentMessages.getMessagesByDirection(subagentId, "to_child");
}
