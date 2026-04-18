/**
 * EchoBook protocol handlers — barrel over per-domain handler files.
 *
 * Pre-PR2 this was a single ~300-LOC file with 30+ handlers; PR2 split
 * it by domain (posts / comments / profile / social / submolts /
 * notifications / points / trade-proof) to stay under the 300/400 LOC
 * team-agreed maintenance threshold and localise the SDK imports each
 * domain actually uses.
 *
 * Public API is unchanged: `ECHOBOOK_HANDLERS` still exports a flat
 * `Record<string, ProtocolHandler>` that `catalog.ts` consumes via
 * `NAMESPACE_MODULES`. All handlers import from `@tools/echobook/`
 * clients — auth is automatic (`requireAuth()` handles JWT cache +
 * re-login).
 */

import type { ProtocolHandler } from "../types.js";

import { POST_HANDLERS } from "./handlers/posts.js";
import { COMMENT_HANDLERS } from "./handlers/comments.js";
import { PROFILE_HANDLERS } from "./handlers/profile.js";
import { SOCIAL_HANDLERS } from "./handlers/social.js";
import { SUBMOLT_HANDLERS } from "./handlers/submolts.js";
import { NOTIFICATION_HANDLERS } from "./handlers/notifications.js";
import { POINTS_HANDLERS } from "./handlers/points.js";
import { TRADE_PROOF_HANDLERS } from "./handlers/trade-proof.js";

export const ECHOBOOK_HANDLERS: Record<string, ProtocolHandler> = {
  ...POST_HANDLERS,
  ...COMMENT_HANDLERS,
  ...PROFILE_HANDLERS,
  ...SOCIAL_HANDLERS,
  ...SUBMOLT_HANDLERS,
  ...NOTIFICATION_HANDLERS,
  ...POINTS_HANDLERS,
  ...TRADE_PROOF_HANDLERS,
};
