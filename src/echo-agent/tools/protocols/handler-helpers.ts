/**
 * Shared protocol handler helpers — extracted from duplicated per-handler utilities.
 *
 * str/num/ok/fail are used identically in all 13 handler files.
 * Consolidating here per Team Standards §2.3 (stop on repetition, 3+ = extract).
 */

import type { ToolResult } from "../types.js";

/** Safe string accessor from params. */
export function str(p: Record<string, unknown>, k: string): string {
  const v = p[k]; return typeof v === "string" ? v : "";
}

/** Safe number accessor from params. */
export function num(p: Record<string, unknown>, k: string): number | undefined {
  const v = p[k]; return typeof v === "number" ? v : undefined;
}

/** Success result with JSON output. */
export function ok(data: unknown): ToolResult {
  return { success: true, output: JSON.stringify(data, null, 2), data: data as Record<string, unknown> };
}

/** Failure result with message. */
export function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

/** Safe boolean accessor from params. */
export function bool(p: Record<string, unknown>, k: string): boolean | undefined {
  return typeof p[k] === "boolean" ? (p[k] as boolean) : undefined;
}

// ── Native gas reserve (future) ─────────────────────────────────
// TODO: Runtime gas reserve backstop for native-token spends.
// Currently enforced via prompt only (DeFi Safety Rules in tool-usage.ts).
// If prompt-level guidance proves insufficient, add safeNativeAmount()
// here that deducts ~10% reserve when spending >90% of native balance.
// Requires moving getKyberEvmClients() before route quote in executeKyberSwap()
// so publicClient.getBalance() is available before amountIn is used.
