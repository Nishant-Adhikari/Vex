/**
 * Shared protocol handler helpers — extracted from duplicated per-handler utilities.
 *
 * str/num/ok/fail are used identically in all 13 handler files.
 * Consolidating here per Team Standards §2.3 (stop on repetition, 3+ = extract).
 *
 * `enumField` is re-exported from `tools/internal/types.ts` where it already
 * exists — same helper, one source of truth. Post-PR1 the protocol runtime
 * validates `ProtocolParamDef.type` (string/number/boolean) at the
 * execute_tool boundary, so by the time a handler calls `enumField` the
 * value is guaranteed to be a string (or missing); the helper narrows it
 * further to the SDK-expected enum set.
 */

import type { ToolResult } from "../types.js";

export { enumField } from "../internal/types.js";

/**
 * Widen an SDK response value to `ToolResult.data`'s open
 * `Record<string, unknown>` shape. The runtime value is structurally
 * compatible — the double-cast exists only because TypeScript rejects
 * `typed-object → Record<string, unknown>` for interfaces without an
 * index signature. Centralising it here keeps handlers that pass through
 * a typed SDK result to one acknowledged unsafe line instead of
 * scattering `as unknown as` around the handler files.
 *
 * Use this ONLY when you are intentionally exposing an SDK response
 * directly as `ToolResult.data`. Prefer constructing a plain object
 * literal (`data: { count, items }`) when the output already wraps the
 * response.
 */
export function toResultData(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

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
  return { success: true, output: JSON.stringify(data), data: data as Record<string, unknown> };
}

/** Failure result with message. */
export function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}

/** Safe boolean accessor from params. */
export function bool(p: Record<string, unknown>, k: string): boolean | undefined {
  return typeof p[k] === "boolean" ? (p[k] as boolean) : undefined;
}

/**
 * Storage bound for a trade `rationale` (the agent's stated reason for a swap,
 * threaded into the trade-capture record so the Decision Journal can show
 * "why", not "No recorded rationale"). Kept in lock-step with the read/IPC
 * bound `MOVE_RATIONALE_MAX` (vex-app/src/shared/schemas/portfolio-moves.ts):
 * the moves-db SQL `LEFT(...)` clamp, the IPC schema `.max(...)`, and this
 * write-side clamp must all agree so a stored value can never overflow the
 * output schema and 500 the panel. One glanceable paragraph, not an essay.
 */
export const TRADE_RATIONALE_MAX = 600;

/**
 * Read + normalise the OPTIONAL `rationale` param the agent fills to justify a
 * mutating trade. Agent-authored (not provider-controlled), but still defended:
 * C0 control chars + DEL are neutralised to spaces (so a newline-injected value
 * can never splice structure into any downstream text/prompt), whitespace is
 * collapsed, and the result is bounded to `TRADE_RATIONALE_MAX`. Returns
 * `undefined` when absent or empty so the capture record simply omits the field
 * (no fabricated rationale). The codepoint loop keeps any control byte out of
 * this source file (mirrors the signals judge's `cleanScalar`).
 */
export function rationale(p: Record<string, unknown>): string | undefined {
  const raw = p["rationale"];
  if (typeof raw !== "string") return undefined;
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? " " : ch;
  }
  out = out.replace(/\s+/g, " ").trim().slice(0, TRADE_RATIONALE_MAX);
  return out.length > 0 ? out : undefined;
}

/** Comma-separated string → trimmed string array. Returns undefined if empty/missing. */
export function strArray(p: Record<string, unknown>, k: string): string[] | undefined {
  const v = typeof p[k] === "string" ? (p[k] as string) : "";
  if (!v) return undefined;
  const arr = v.split(",").map(s => s.trim()).filter(Boolean);
  return arr.length > 0 ? arr : undefined;
}

/** Comma-separated string → number array. Filters out non-finite values. Returns undefined if empty/missing. */
export function numArray(p: Record<string, unknown>, k: string): number[] | undefined {
  const v = typeof p[k] === "string" ? (p[k] as string) : "";
  if (!v) return undefined;
  const arr = v.split(",").map(Number).filter(n => Number.isFinite(n));
  return arr.length > 0 ? arr : undefined;
}

// ── Native gas reserve (future) ─────────────────────────────────
// TODO: Runtime gas reserve backstop for native-token spends.
// Currently enforced via prompt only (DeFi Safety Rules in tool-usage.ts).
// If prompt-level guidance proves insufficient, add safeNativeAmount()
// here that deducts ~10% reserve when spending >90% of native balance.
// Requires moving getKyberEvmClients() before route quote in executeKyberSwap()
// so publicClient.getBalance() is available before amountIn is used.
