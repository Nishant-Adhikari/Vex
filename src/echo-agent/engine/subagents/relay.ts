/**
 * Subagent relay — message passing parent ↔ child.
 *
 * Thin delegation to subagent-messages.ts repo.
 * No "unread" semantics (repo has no cursor/ack).
 */

import * as subagentMessages from "@echo-agent/db/repos/subagent-messages.js";

export async function relayToParent(subagentId: string, content: string): Promise<void> {
  await subagentMessages.sendMessage(subagentId, "to_parent", content);
}

export async function relayToChild(subagentId: string, content: string): Promise<void> {
  await subagentMessages.sendMessage(subagentId, "to_child", content);
}

export async function getMessagesToParent(subagentId: string) {
  return subagentMessages.getMessagesByDirection(subagentId, "to_parent");
}

export async function getMessagesToChild(subagentId: string) {
  return subagentMessages.getMessagesByDirection(subagentId, "to_child");
}
