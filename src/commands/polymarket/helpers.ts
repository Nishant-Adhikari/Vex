/**
 * Shared CLI helpers for Polymarket commands.
 */

import { EchoError, ErrorCodes } from "../../errors.js";
import { hasPolyClobCredentials } from "../../tools/polymarket/auth.js";

/** Ensure CLOB API is configured. Throws with setup hint if not. */
export function requirePolyAuth(): void {
  if (!hasPolyClobCredentials()) {
    throw new EchoError(
      ErrorCodes.POLYMARKET_NOT_CONFIGURED,
      "Polymarket CLOB API key not configured",
      "Run 'echoclaw polymarket setup --yes' to auto-generate API credentials.",
    );
  }
}

/** Parse outcomes JSON string → [YES price, NO price]. */
export function parseOutcomePrices(outcomePrices: string | null): { yes: number; no: number } {
  if (!outcomePrices) return { yes: 0, no: 0 };
  try {
    const parsed = JSON.parse(outcomePrices);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return { yes: parseFloat(parsed[0]) || 0, no: parseFloat(parsed[1]) || 0 };
    }
  } catch { /* ignore */ }
  return { yes: 0, no: 0 };
}

/** Parse outcomes JSON string → ["Yes", "No"]. */
export function parseOutcomes(outcomes: string | null): string[] {
  if (!outcomes) return ["Yes", "No"];
  try {
    const parsed = JSON.parse(outcomes);
    if (Array.isArray(parsed)) return parsed;
  } catch { /* ignore */ }
  return ["Yes", "No"];
}

/** Parse clobTokenIds JSON string → [yesTokenId, noTokenId]. */
export function parseClobTokenIds(clobTokenIds: string | null): { yes: string; no: string } {
  if (!clobTokenIds) return { yes: "", no: "" };
  try {
    const parsed = JSON.parse(clobTokenIds);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return { yes: parsed[0], no: parsed[1] };
    }
  } catch { /* ignore */ }
  return { yes: "", no: "" };
}

/** Format USD amount. */
export function formatUsd(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "$—";
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Format probability as percentage. */
export function formatProbability(price: number | null | undefined): string {
  if (price == null || Number.isNaN(price)) return "—%";
  return `${(price * 100).toFixed(1)}%`;
}
