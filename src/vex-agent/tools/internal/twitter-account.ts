import { TwitterAccountParamsSchema } from "@tools/twitter-account/schema.js";
import {
  executeTwitterAccountRequest,
  sanitizeTwitterAccountError,
} from "@tools/twitter-account/client.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { fail, ok } from "./types.js";

export async function handleTwitterAccount(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  const parsed = TwitterAccountParamsSchema.safeParse(params);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(`twitter_account: ${formatValidationIssue(issue)}`);
  }

  try {
    return ok(await executeTwitterAccountRequest(parsed.data));
  } catch (error) {
    return fail(`twitter_account: ${sanitizeTwitterAccountError(error)}`);
  }
}

function formatValidationIssue(
  issue: { path: PropertyKey[]; message: string } | undefined,
): string {
  if (!issue) return "invalid arguments";
  const path = issue.path.map(String).join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}
