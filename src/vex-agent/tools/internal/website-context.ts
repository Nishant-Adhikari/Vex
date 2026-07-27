/**
 * Internal handler for `website_context` — fetch a token project's website and
 * return context + neutral quality signals.
 *
 * Thin adapter: params → decoupled core ({@link fetchWebsiteContext}) → ToolResult.
 * The core lives in `@tools/website-context/*` (generic, no fork deps —
 * upstreamable). This handler NEVER throws: an `unavailable` result is normal
 * data (a caution signal), so it is returned as a successful tool call carrying
 * `status: "unavailable"`, never a hard failure that could disrupt a mission.
 */

import { fetchWebsiteContext } from "@tools/website-context/client.js";
import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { ok, str } from "./types.js";

export async function handleWebsiteContext(
  params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  // `url` is optional by contract: a missing/blank value is a valid call whose
  // result is `unavailable("no website")` — itself a caution signal.
  const url = str(params, "url");
  const result = await fetchWebsiteContext(url);
  return ok(result);
}
