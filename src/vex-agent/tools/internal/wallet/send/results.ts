/**
 * Wallet send — shared `ToolResult` constructors for the prepare/confirm
 * handlers and outcome finalisation. Single-instanced helpers so prepare,
 * confirm, and finalize all produce the identical `ToolResult` shape.
 */

import type { ToolResult } from "../../../types.js";

export function ok(data: unknown): ToolResult {
  return {
    success: true,
    output: JSON.stringify(data, null, 2),
    data: data as Record<string, unknown>,
  };
}

export function fail(msg: string): ToolResult {
  return { success: false, output: msg };
}
