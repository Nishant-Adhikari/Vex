/**
 * Polymarket setup — derive CLOB API credentials from wallet keystore.
 *
 * Visible ONLY when POLYMARKET_API_KEY is not configured.
 * No secrets in output — only apiKeyPrefix (first 8 chars).
 */

import type { ToolResult } from "../types.js";
import type { InternalToolContext } from "./types.js";
import { ok, fail } from "./types.js";

export async function handlePolymarketSetup(
  _params: Record<string, unknown>,
  _context: InternalToolContext,
): Promise<ToolResult> {
  // Defense in depth: check if already configured
  const { hasPolyClobCredentials } = await import("@tools/polymarket/auth.js");
  if (hasPolyClobCredentials()) {
    return ok({ configured: true, note: "Polymarket CLOB credentials already configured." });
  }

  try {
    const { deriveAndSavePolymarketCredentials } = await import("@tools/wallet/polymarket-credentials.js");
    const result = await deriveAndSavePolymarketCredentials();

    return ok({
      configured: true,
      apiKeyPrefix: result.apiKeyPrefix,
      storage: result.storage,
      note: "Polymarket CLOB credentials saved. Trading tools (buy/sell/cancel) are now available.",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return fail(`Polymarket setup failed: ${msg}`);
  }
}
